const express = require('express');
const jwt     = require('jsonwebtoken');

const pool                = require('../config/db');
const { logAudit, getIp } = require('../services/auditService');
const { verifyPassword }  = require('../utils/password');

const router = express.Router();

/**
 * POST /api/auth/login
 *
 * Auth resolution order:
 *   1. ALLOW_DEV_LOGIN bypass — if enabled AND the submitted
 *      credentials match DEV_ADMIN_USER / DEV_ADMIN_PASSWORD,
 *      log the user in as a local admin.  Off-by-default, gated by
 *      env, and announced at boot.
 *   2. Otherwise verify the submitted code against the LOCAL
 *      users.password_hash (scrypt — see src/utils/password.js).
 *      Authentication is fully self-contained; no Odoo involved.
 *      Admins create users + set passwords via /api/users; users
 *      change their own via /api/users/me/password.
 */
router.post('/login', async (req, res) => {
  const { username, code } = req.body;
  const ipAddress = getIp(req);

  if (!username || !code) {
    return res.status(400).json({ message: 'Username and code are required.' });
  }

  // ── 1. Dev-admin bypass (off unless ALLOW_DEV_LOGIN=true) ────────
  if (isDevAdminAttempt(username, code)) {
    let localUser;
    try {
      localUser = await upsertDevAdmin(username);
    } catch (err) {
      return sendStoreUnavailable(res, '[auth] Dev-admin upsert failed', err);
    }
    return issueToken(res, localUser, ipAddress, { devLogin: true });
  }

  // ── 2. Local password auth (no Odoo) ─────────────────────────────
  // Look the user up by username (case-insensitive) and verify the
  // submitted code against the stored scrypt hash.  Replaces the old
  // Odoo XML-RPC flow — authentication is now fully self-contained.
  let localUser;
  try {
    const { rows } = await pool.query(
      `SELECT id, odoo_uid, username, name, email, role, can_view_prices,
              is_active, password_hash, must_change_password
       FROM   users
       WHERE  lower(username) = lower($1)`,
      [username]
    );
    localUser = rows[0];
  } catch (err) {
    return sendStoreUnavailable(res, '[auth] Local user lookup failed', err);
  }

  const passwordOk =
    localUser && verifyPassword(code, localUser.password_hash);

  if (!localUser || !passwordOk) {
    await logAudit({
      userId:      null,
      actionType:  'login_failure',
      entity:      'auth',
      description: `Invalid credentials for "${username}"`,
      ipAddress,
    });
    return res.status(401).json({ message: 'Invalid credentials.' });
  }

  if (!localUser.is_active) {
    await logAudit({
      userId:      localUser.id,
      actionType:  'login_denied',
      entity:      'user',
      entityId:    localUser.id,
      description: `Deactivated account "${localUser.username}" attempted to log in.`,
      ipAddress,
    });
    return res.status(403).json({
      message: 'Account is deactivated. Contact an administrator.',
    });
  }

  // Stamp last_login (best-effort; failure here should not block login)
  try {
    await pool.query(
      `UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = $1`,
      [localUser.id]
    );
  } catch (err) {
    console.warn('[auth] last_login update failed (non-fatal):', err.message);
  }

  return issueToken(res, localUser, ipAddress, { devLogin: false });
});

/**
 * sendStoreUnavailable — uniform handler for local-DB failures.
 *   • Always logs the full error (with code + stack) server-side.
 *   • When ALLOW_DEV_LOGIN is on, returns the real reason in the
 *     response body so the developer can see "relation does not
 *     exist", "ECONNREFUSED", "password authentication failed", etc.
 *   • In production, returns the generic message — no internal
 *     details leak to the client.
 */
function sendStoreUnavailable(res, contextLabel, err) {
  console.error(`${contextLabel}:`, err.code || '', err.message);
  if (err.stack) console.error(err.stack);

  const body = { message: 'Local authentication store unavailable.' };
  if (devLoginEnabled()) {
    body.detail = `${err.code ? `[${err.code}] ` : ''}${err.message}`;
    body.hint = err.code === '42P01'
      ? 'Table missing — run `npm run db:migrate`.'
      : (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND')
        ? 'Cannot reach Postgres — check DB_HOST / DB_PORT in .env.'
        : (err.code === '28P01' || err.code === '28000')
          ? 'Postgres rejected the credentials — check DB_USER / DB_PASSWORD.'
          : undefined;
  }
  return res.status(500).json(body);
}

// ─── Dev-only local admin bypass ─────────────────────────────────────

function devLoginEnabled() {
  return process.env.ALLOW_DEV_LOGIN === 'true';
}

function isDevAdminAttempt(username, code) {
  if (!devLoginEnabled()) return false;
  const u = process.env.DEV_ADMIN_USER;
  const p = process.env.DEV_ADMIN_PASSWORD;
  if (!u || !p) return false;
  return username === u && code === p;
}

/**
 * Upsert the dev-admin user.  No odoo_uid (NULL is fine — Postgres
 * treats NULLs as distinct under UNIQUE), conflict target is the
 * username, role is forced to 'admin', is_active forced TRUE.
 * can_view_prices is left as-is so the existing role-default applies.
 */
async function upsertDevAdmin(username) {
  const { rows } = await pool.query(
    `INSERT INTO users (username, name, role, is_active, last_login)
     VALUES ($1, $2, 'admin', TRUE, NOW())
     ON CONFLICT (username) DO UPDATE SET
       role       = 'admin',
       is_active  = TRUE,
       last_login = NOW(),
       updated_at = NOW()
     RETURNING id, odoo_uid, username, name, email, role, can_view_prices, is_active`,
    [username, 'Local Dev Admin']
  );
  return rows[0];
}

// ─── Token issuance + audit (shared by both auth paths) ──────────────

function issueToken(res, localUser, ipAddress, { devLogin }) {
  const secret  = process.env.JWT_SECRET;
  const expires = process.env.JWT_EXPIRES_IN ?? '8h';

  if (!secret || secret.includes('REPLACE_WITH')) {
    console.error('[auth] JWT_SECRET is not configured.');
    return res.status(500).json({ message: 'Server configuration error.' });
  }

  const token = jwt.sign(
    {
      userId:   localUser.id,
      odooUid:  localUser.odoo_uid,
      username: localUser.username,
      name:     localUser.name,
    },
    secret,
    { expiresIn: expires }
  );

  logAudit({
    userId:      localUser.id,
    actionType:  'login_success',
    entity:      'user',
    entityId:    localUser.id,
    description: devLogin
      ? `DEV-LOGIN: "${localUser.username}" logged in as admin (ALLOW_DEV_LOGIN bypass).`
      : `User "${localUser.username}" logged in (role=${localUser.role}).`,
    ipAddress,
  });

  return res.json({
    token,
    user: {
      id:       localUser.id,
      odoo_uid: localUser.odoo_uid,
      username: localUser.username,
      name:     localUser.name,
      email:    localUser.email,
      role:     localUser.role,
      can_view_prices: localUser.can_view_prices,
      must_change_password: localUser.must_change_password ?? false,
    },
  });
}

module.exports = router;
// expose for app.js startup banner
module.exports.devLoginEnabled = devLoginEnabled;
