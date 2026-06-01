import React, { useState, FormEvent } from 'react';
import { api } from '../../api';
import { useLang } from '../../context/LanguageContext';
import { useToastStore } from '../../stores/useToastStore';

/**
 * Self-service "change my password" dialog, available to every
 * authenticated user from the top-bar menu.  Calls
 * POST /api/users/me/password which verifies the current password
 * before storing the new scrypt hash.
 */
export const ChangePasswordModal: React.FC<{ open: boolean; onClose: () => void }> = ({
  open, onClose,
}) => {
  const { t } = useLang();
  const toast = useToastStore((s) => s.push);

  const [current, setCurrent] = useState('');
  const [next,    setNext]    = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  if (!open) return null;

  const reset = () => { setCurrent(''); setNext(''); setConfirm(''); setError(null); };
  const close = () => { reset(); onClose(); };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (next.length < 4)      { setError(t.changePwTooShort); return; }
    if (next !== confirm)     { setError(t.changePwMismatch); return; }

    setLoading(true);
    try {
      await api.changeMyPassword(current, next);
      toast(t.changePwSuccess, { type: 'success' });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="change-pw__overlay" role="dialog" aria-modal="true" onClick={close}>
      <div className="change-pw__dialog" onClick={(e) => e.stopPropagation()}>
        <div className="change-pw__header">
          <h3 className="change-pw__title">{t.changePwTitle}</h3>
          <button className="change-pw__close" onClick={close} aria-label={t.changePwCancel}>✕</button>
        </div>

        <form className="change-pw__form" onSubmit={handleSubmit}>
          {error && <div className="change-pw__error" role="alert">{error}</div>}

          <label className="change-pw__field">
            <span>{t.changePwCurrent}</span>
            <input
              type="password" value={current} autoComplete="current-password"
              onChange={(e) => setCurrent(e.target.value)} disabled={loading} autoFocus
            />
          </label>
          <label className="change-pw__field">
            <span>{t.changePwNew}</span>
            <input
              type="password" value={next} autoComplete="new-password" minLength={4}
              onChange={(e) => setNext(e.target.value)} disabled={loading} required
            />
          </label>
          <label className="change-pw__field">
            <span>{t.changePwConfirm}</span>
            <input
              type="password" value={confirm} autoComplete="new-password" minLength={4}
              onChange={(e) => setConfirm(e.target.value)} disabled={loading} required
            />
          </label>

          <div className="change-pw__actions">
            <button type="button" className="btn btn--ghost" onClick={close} disabled={loading}>
              {t.changePwCancel}
            </button>
            <button type="submit" className="btn btn--primary" disabled={loading || !next || !confirm}>
              {loading ? t.changePwSaving : t.changePwSubmit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
