import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useLang } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../stores/useToastStore';
import type { UserRow } from '../../types';

/**
 * Admin-only user management panel for the SettingsPage.
 *
 * Authentication is now LOCAL (no Odoo): admins create users with an
 * initial password and can reset any user's password.  Each user can
 * change their own password from the top-bar menu.
 *
 * Backend still enforces:
 *   • last-active-admin lockout
 *   • role / can_view_prices / is_active patch validation
 *   • unique username on create
 * — so this UI just provides controls and surfaces server errors.
 *
 * can_view_prices is a true three-state:
 *   null  → "Default (role-based)"  — admin sees prices, customer does not
 *   true  → explicit YES override
 *   false → explicit NO override
 */
export const UserManagementPanel: React.FC = () => {
  const { t } = useLang();
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.push);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users-list'],
    queryFn:  () => api.getUsers(),
    staleTime: 30_000,
  });

  const { mutate: saveUser, variables: pendingVars, isPending } = useMutation({
    mutationFn: (args: { id: number; patch: Parameters<typeof api.updateUser>[1] }) =>
      api.updateUser(args.id, args.patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users-list'] });
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: (err: Error) => {
      toast('Update failed', { type: 'error', message: err.message });
    },
  });

  // ── Create-user form state ─────────────────────────────────────────
  const [form, setForm] = useState({
    username: '', name: '', email: '', password: '',
    role: 'customer' as 'admin' | 'customer',
  });
  const setField = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const { mutate: createUser, isPending: creating } = useMutation({
    mutationFn: () => api.createUser({
      username: form.username.trim(),
      password: form.password,
      name:     form.name.trim()  || undefined,
      email:    form.email.trim() || undefined,
      role:     form.role,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users-list'] });
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
      toast(t.userCreatedToast, { type: 'success' });
      setForm({ username: '', name: '', email: '', password: '', role: 'customer' });
    },
    onError: (err: Error) => {
      toast(t.userCreateFailed, { type: 'error', message: err.message });
    },
  });

  // ── Reset-password (admin) ─────────────────────────────────────────
  const { mutate: resetPw, variables: resetVars, isPending: resetting } = useMutation({
    mutationFn: (args: { id: number; password: string }) =>
      api.resetUserPassword(args.id, args.password),
    onSuccess: () => toast(t.userResetPwToast, { type: 'success' }),
    onError: (err: Error) =>
      toast(t.userResetPwFailed, { type: 'error', message: err.message }),
  });

  const handleResetPw = (u: UserRow) => {
    const pw = window.prompt(t.userResetPwPrompt.replace('{name}', u.name || u.username));
    if (pw == null) return;            // cancelled
    if (pw.trim().length < 4) {
      toast(t.changePwTooShort, { type: 'warning' });
      return;
    }
    resetPw({ id: u.id, password: pw });
  };

  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString('en-ZA', {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })
      : '—';

  const cvpValue = (u: UserRow) =>
    u.can_view_prices === true  ? 'true'  :
    u.can_view_prices === false ? 'false' : 'default';

  const parseCvp = (raw: string): boolean | null =>
    raw === 'true' ? true : raw === 'false' ? false : null;

  const canSubmit = form.username.trim().length > 0 && form.password.length >= 4;

  return (
    <div className="user-mgmt">
      <h3 className="user-mgmt__title">{t.usersTitle}</h3>
      <p className="user-mgmt__desc">{t.usersDesc}</p>

      {/* ── Create user ─────────────────────────────────────────── */}
      <form
        className="user-create"
        onSubmit={(e) => { e.preventDefault(); if (canSubmit && !creating) createUser(); }}
      >
        <h4 className="user-create__title">{t.userCreateTitle}</h4>
        <div className="user-create__grid">
          <label className="user-create__field">
            <span>{t.userFieldUsername}</span>
            <input value={form.username} onChange={setField('username')}
                   autoComplete="off" required />
          </label>
          <label className="user-create__field">
            <span>{t.userFieldName}</span>
            <input value={form.name} onChange={setField('name')} autoComplete="off" />
          </label>
          <label className="user-create__field">
            <span>{t.userFieldEmail}</span>
            <input type="email" value={form.email} onChange={setField('email')}
                   autoComplete="off" />
          </label>
          <label className="user-create__field">
            <span>{t.userFieldPassword}</span>
            <input type="text" value={form.password} onChange={setField('password')}
                   autoComplete="new-password" required minLength={4} />
          </label>
          <label className="user-create__field">
            <span>{t.userFieldRole}</span>
            <select value={form.role} onChange={setField('role')}>
              <option value="customer">{t.userRoleCustomer}</option>
              <option value="admin">{t.userRoleAdmin}</option>
            </select>
          </label>
          <div className="user-create__submit">
            <button type="submit" className="btn btn--primary" disabled={!canSubmit || creating}>
              {creating ? t.userCreating : t.userCreateBtn}
            </button>
          </div>
        </div>
      </form>

      {isLoading ? (
        <p className="user-mgmt__loading">{t.loading}</p>
      ) : (
        <table className="user-mgmt__table">
          <thead>
            <tr>
              <th>{t.userColUser}</th>
              <th>{t.userColRole}</th>
              <th>{t.userColCanViewPrices}</th>
              <th>{t.userColActive}</th>
              <th>{t.userColLastLogin}</th>
              <th className="user-mgmt__actions-col">{t.userColActions}</th>
            </tr>
          </thead>
          <tbody>
            {(users as UserRow[]).map((u) => {
              const isMe = me?.id === u.id;
              const rowPending = isPending && pendingVars?.id === u.id;
              const rowResetting = resetting && resetVars?.id === u.id;
              return (
                <tr key={u.id} className={u.is_active ? '' : 'user-mgmt__row--inactive'}>
                  <td>
                    <div className="user-mgmt__name">
                      {u.name || u.username}
                      {isMe && <span className="user-mgmt__me-pill">you</span>}
                    </div>
                    <div className="user-mgmt__sub">
                      {u.username}{u.email ? ` · ${u.email}` : ''}
                    </div>
                  </td>
                  <td>
                    <select
                      value={u.role}
                      disabled={rowPending}
                      onChange={(e) =>
                        saveUser({
                          id: u.id,
                          patch: { role: e.target.value as 'admin' | 'customer' },
                        })
                      }
                    >
                      <option value="admin">admin</option>
                      <option value="customer">customer</option>
                    </select>
                  </td>
                  <td>
                    <select
                      value={cvpValue(u)}
                      disabled={rowPending}
                      onChange={(e) =>
                        saveUser({
                          id: u.id,
                          patch: { can_view_prices: parseCvp(e.target.value) },
                        })
                      }
                    >
                      <option value="default">{t.userCvpDefault}</option>
                      <option value="true">{t.userCvpYes}</option>
                      <option value="false">{t.userCvpNo}</option>
                    </select>
                  </td>
                  <td>
                    {u.is_active ? '✓' : '—'}
                  </td>
                  <td className="user-mgmt__last-login">
                    {fmtDate(u.last_login)}
                  </td>
                  <td className="user-mgmt__actions">
                    <button
                      className="btn btn--sm btn--ghost"
                      disabled={rowResetting}
                      onClick={() => handleResetPw(u)}
                    >
                      {rowResetting ? t.userSavePending : t.userResetPwBtn}
                    </button>
                    <button
                      className={`btn btn--sm ${u.is_active ? 'btn--ghost' : 'btn--primary'}`}
                      disabled={rowPending}
                      onClick={() =>
                        saveUser({ id: u.id, patch: { is_active: !u.is_active } })
                      }
                    >
                      {rowPending
                        ? t.userSavePending
                        : (u.is_active ? t.userDeactivate : t.userActivate)}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
