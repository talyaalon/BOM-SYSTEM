import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useLang } from '../../context/LanguageContext';
import { useToastStore } from '../../stores/useToastStore';

/**
 * ERP Integration panel (replaces the old Odoo sync panel).
 *
 * In this standalone DEMO build there is no live ERP connection — the
 * catalogue is seeded with sample data.  This panel explains that and
 * keeps the (locally working) "recalculate all recipe costs" action.
 */
export const ErpIntegrationPanel: React.FC = () => {
  const { t } = useLang();
  const qc = useQueryClient();
  const toast = useToastStore((s) => s.push);

  const { mutate: runRecalc, isPending: recalculating } = useMutation({
    mutationFn: api.triggerCostRecalc,
    onSuccess: (data) => {
      toast(t.odooSyncRecalcDoneToast, {
        type: 'success',
        message: `${data.recalculated} recipes recalculated.`,
      });
      qc.invalidateQueries({ queryKey: ['boms'] });
      qc.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: (err: Error) => toast('Recalculation failed', { type: 'error', message: err.message }),
  });

  return (
    <div className="sync-panel">
      <h3 className="sync-panel__title">
        {t.erpTitle}
        <span className="erp-panel__badge">{t.erpDemoBadge}</span>
      </h3>

      <div className="erp-panel__note">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <p>{t.erpDemoNote}</p>
      </div>

      <p className="sync-panel__desc">{t.erpRecalcNote}</p>
      <div className="sync-panel__actions">
        <button
          className="btn btn--ghost"
          onClick={() => runRecalc()}
          disabled={recalculating}
        >
          {recalculating ? t.odooSyncRunning : t.odooSyncRecalc}
        </button>
      </div>
    </div>
  );
};
