import type { ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';
import { useT } from '../i18n/i18n';

export interface ConfirmAction {
  id: string;
  label: string;
  /** Visual weight; destructive choices default to 'danger'. */
  variant?: 'primary' | 'ghost' | 'danger';
  onSelect: () => void;
}

/**
 * Universal confirmation dialog: a title, an optional body and a REGISTRY of
 * actions — one entry for a plain "really delete?", several when the operator
 * has a real choice (e.g. a room's release-vs-delete-members). Cancel is
 * always present, always safe, and every action closes the dialog first.
 * Built on Modal (portal, Escape, overlay click), so it works anywhere.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  actions,
  onClose,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  actions: ConfirmAction[];
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal open={open} label={title} onClose={onClose}>
      <div className="border-b border-edge px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      {body !== undefined && <div className="p-4 text-sm text-ink-muted">{body}</div>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-edge px-4 py-2.5">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        {actions.map((action) => (
          <Button
            key={action.id}
            variant={action.variant ?? 'danger'}
            onClick={() => {
              onClose();
              action.onSelect();
            }}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </Modal>
  );
}
