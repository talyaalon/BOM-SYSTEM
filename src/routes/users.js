/**
 * routes/users.js
 *
 * Admin-only user management.  No password endpoints — authentication
 * is external (Odoo).  Local `users` rows are a cache populated by
 * /api/auth/login; admins can change role, can_view_prices, is_active.
 *
 * Every mutation writes an audit_logs row with value_before /
 * value_after JSON so changes are diffable.
 *
 * Endpoints (all behind requireAdmin):
 *   GET   /api/users           — list (filterable: ?role=, ?active=)
 *   GET   /api/users/:id       — single user
 *   PATCH /api/users/:id       — update role / can_view_prices / is_active
 *   GET   /api/users/me        — current user's own row (any auth'd user)
 *   GET   /api/users/audit/:id — recent audit log for a user (admin)
 *
 * Note: GET /me is open to any authenticated user so the frontend can
 * refresh role/permissions without re-login.
 */

const express = require('express');
const pool    = require('../config/db');
const { requireAdmin }   = require('../middleware/authMiddleware');
const { logAudit, getIp } = require('../services/auditService');
const { hashPassword, verifyPassword } = require('../utils/password');

const router = express.Router();

const PUBLIC_COLS =
  'id, odoo_uid, username, name, email, role, can_view_prices, is_active, last_login, created_at, updated_at';

// Minimum password length accepted by create / reset / self-change.
const MIN_PASSWORD_LEN = 4;

// ── GET /api/users/me — open to any authenticated user ──────────────
// Mounted before requireAdmin so a customer can fetch their own row
// to refresh role / can_view_prices after an admin changes it.
router.get('/me', (req, res) => {
  if (!req.localUser) return res.status(401).json({ message: 'Not authenticated.' });
  const u = req.localUser;
  res.json({
    id:              u.id,
    odoo_uid:        u.odoo_uid,
    username:        u.username,
    name:            u.name,
    email:           u.email,
    role:            u.role,
    can_view_prices: u.can_view_prices,
    is_active:       u.is_active,
  });
});

// ── POST /api/users/me/password — change OWN password ──────────────
// Open to any authenticated user (mounted before requireAdmin).  Body:
//   { current_password, new_password }
// Verifies the current password, stores a fresh scrypt hash and clears
// the must_change_password flag.
router.post('/me/password', async (req, res) => {
  if (!req.localUser) return res.status(401).json({ message: 'Not authenticated.' });

  const { current_password, new_password } = req.body ?? {};
  if (!new_password || new_password.length < MIN_PASSWORD_LEN) {
    return res.status(400).json({
      message: `New password must be at least ${MIN_PASSWORD_LEN} characters.`,
    });
  }

  // Fetch the current hash (req.localUser does not carry it)
  const { rows } = await pool.query(
    `SELECT password_hash FROM users WHERE id = $1`,
    [req.localUser.id]
  );
  const stored = rows[0]?.password_hash;

  // If the account already has a password, the current one must match.
  // (Accounts seeded without a password can set one without the check.)
  if (stored && !verifyPassword(current_password ?? '', stored)) {
    return res.status(401).json({ message: 'Current password is incorrect.' });
  }

  await pool.query(
    `UPDATE users
       SET password_hash = $1, must_change_password = FALSE, updated_at = NOW()
     WHERE id = $2`,
    [hashPassword(new_password), req.localUser.id]
  );

  await logAudit({
    userId:      req.localUser.id,
    actionType:  'user_password_change',
    entity:      'user',
    entityId:    req.localUser.id,
    description: `User "${req.localUser.username}" changed their own password.`,
    ipAddress:   getIp(req),
  });

  res.json({ message: 'Password updated.' });
});

// ── Everything below requires admin ─────────────────────────────────
router.use(requireAdmin);

// POST /api/users — create a new user with an initial password (admin)
// Body: { username, password, name?, email?, role?, can_view_prices? }
router.post('/', async (req, res) => {
  const { username, password, name, email, role, can_view_prices } = req.body ?? {};

  if (!username || !String(username).trim()) {
    return res.status(400).json({ error: 'username is required' });
  }
  if (!password || password.length < MIN_PASSWORD_LEN) {
    return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LEN} characters` });
  }
  if (role !== undefined && role !== 'admin' && role !== 'customer') {
    return res.status(400).json({ error: "role must be 'admin' or 'customer'" });
  }
  if (
    can_view_prices !== undefined &&
    can_view_prices !== true && can_view_prices !== false && can_view_prices !== null
  ) {
    return res.status(400).json({ error: 'can_view_prices must be true, false, or null' });
  }

  // Reject duplicate username up-front for a friendly message (the
  // UNIQUE constraint is still the real guard).
  const { rows: dup } = await pool.query(
    `SELECT 1 FROM users WHERE lower(username) = lower($1)`,
    [username.trim()]
  );
  if (dup.length) {
    return res.status(409).json({ error: 'A user with this username already exists.' });
  }

  let created;
  try {
    const { rows } = await pool.query(
      `INSERT INTO users
         (username, name, email, role, can_view_prices, password_hash,
          must_change_password, is_active)
       VALUES ($1, $2, $3, COALESCE($4, 'customer'), $5, $6, TRUE, TRUE)
       RETURNING ${PUBLIC_COLS}`,
      [username.trim(), name ?? null, email ?? null, role ?? null,
       can_view_prices ?? null, hashPassword(password)]
    );
    created = rows[0];
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A user with this username already exists.' });
    }
    throw err;
  }

  await logAudit({
    userId:      req.localUser.id,
    actionType:  'user_create',
    entity:      'user',
    entityId:    created.id,
    description: `Admin "${req.localUser.username}" created user "${created.username}" (role=${created.role}).`,
    valueAfter:  { username: created.username, role: created.role },
    ipAddress:   getIp(req),
  });

  res.status(201).json(created);
});

// POST /api/users/:id/reset-password — admin sets a user's password
// Body: { password }.  Forces must_change_password so the user is
// nudged to pick their own on next login.
router.post('/:id/reset-password', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid user id' });

  const { password } = req.body ?? {};
  if (!password || password.length < MIN_PASSWORD_LEN) {
    return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LEN} characters` });
  }

  const { rows } = await pool.query(
    `UPDATE users
       SET password_hash = $1, must_change_password = TRUE, updated_at = NOW()
     WHERE id = $2
     RETURNING ${PUBLIC_COLS}`,
    [hashPassword(password), id]
  );
  if (!rows.length) return res.status(404).json({ error: 'user not found' });

  await logAudit({
    userId:      req.localUser.id,
    actionType:  'user_password_reset',
    entity:      'user',
    entityId:    id,
    description: `Admin "${req.localUser.username}" reset the password for "${rows[0].username}".`,
    ipAddress:   getIp(req),
  });

  res.json({ message: 'Password reset.', user: rows[0] });
});

// GET /api/users — list, with optional filters
router.get('/', async (req, res) => {
  const { role, active } = req.query;
  const params = [];
  const where  = [];

  if (role) {
    params.push(role);
    where.push(`role = $${params.length}`);
  }
  if (active === 'true' || active === 'false') {
    params.push(active === 'true');
    where.push(`is_active = $${params.length}`);
  }

  const sql =
    `SELECT ${PUBLIC_COLS} FROM users
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY name NULLS LAST, username`;

  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

// GET /api/users/:id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid user id' });

  const { rows } = await pool.query(
    `SELECT ${PUBLIC_COLS} FROM users WHERE id = $1`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: 'user not found' });
  res.json(rows[0]);
});

// PATCH /api/users/:id — update role, can_view_prices, is_active
//
// can_view_prices is THREE-STATE:
//   null  → "default" (follow role default at read time)
//   true  → explicit grant
//   false → explicit deny
//
// Accept the body shape:
//   { role?: 'admin'|'customer',
//     can_view_prices?: true|false|null,
//     is_active?: boolean }
router.patch('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid user id' });

  const { role, can_view_prices, is_active } = req.body ?? {};

  // ── Validate inputs explicitly (incl. the three-state field) ─────
  if (role !== undefined && role !== 'admin' && role !== 'customer') {
    return res.status(400).json({ error: "role must be 'admin' or 'customer'" });
  }
  if (
    can_view_prices !== undefined &&
    can_view_prices !== true &&
    can_view_prices !== false &&
    can_view_prices !== null
  ) {
    return res.status(400).json({
      error: 'can_view_prices must be true, false, or null (default)',
    });
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active must be boolean' });
  }

  // ── Anti-lockout: prevent the last active admin demoting/
  //                  deactivating themselves and losing all admin access
  if (id === req.localUser.id) {
    const wantsDemote     = role === 'customer';
    const wantsDeactivate = is_active === false;
    if (wantsDemote || wantsDeactivate) {
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM users
         WHERE role = 'admin' AND is_active = TRUE AND id <> $1`,
        [id]
      );
      if (countRows[0].n === 0) {
        return res.status(409).json({
          error:
            'Cannot demote or deactivate the last active admin. Promote another admin first.',
        });
      }
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch the BEFORE snapshot inside the transaction for the audit row
    const { rows: beforeRows } = await client.query(
      `SELECT ${PUBLIC_COLS} FROM users WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!beforeRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'user not found' });
    }
    const before = beforeRows[0];

    // Build a partial UPDATE only with provided fields
    const sets   = [];
    const params = [];
    if (role !== undefined) {
      params.push(role);
      sets.push(`role = $${params.length}`);
    }
    if (can_view_prices !== undefined) {
      params.push(can_view_prices);
      sets.push(`can_view_prices = $${params.length}`);
    }
    if (is_active !== undefined) {
      params.push(is_active);
      sets.push(`is_active = $${params.length}`);
    }

    if (!sets.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'no updatable fields supplied' });
    }

    params.push(id);
    const { rows: afterRows } = await client.query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}
       RETURNING ${PUBLIC_COLS}`,
      params
    );
    const after = afterRows[0];

    // Diff: only include fields that actually changed
    const diffBefore = {};
    const diffAfter  = {};
    for (const key of ['role', 'can_view_prices', 'is_active']) {
      if (before[key] !== after[key]) {
        diffBefore[key] = before[key];
        diffAfter[key]  = after[key];
      }
    }

    await logAudit(
      {
        userId:      req.localUser.id,
        actionType:  'user_update',
        entity:      'user',
        entityId:    id,
        description: `Admin "${req.localUser.username}" updated user "${after.username}"`,
        valueBefore: diffBefore,
        valueAfter:  diffAfter,
        ipAddress:   getIp(req),
      },
      client
    );

    await client.query('COMMIT');
    res.json(after);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// GET /api/users/:id/audit — recent audit history for a user
router.get('/:id/audit', async (req, res) => {
  const id    = parseInt(req.params.id);
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  if (!id) return res.status(400).json({ error: 'invalid user id' });

  const { rows } = await pool.query(
    `SELECT id, action_type, entity, entity_id, description,
            value_before, value_after, ip_address, created_at
     FROM   audit_logs
     WHERE  user_id = $1 OR (entity = 'user' AND entity_id = $1)
     ORDER  BY created_at DESC
     LIMIT  $2`,
    [id, limit]
  );
  res.json(rows);
});

module.exports = router;
