import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Dialog width cap — an enum, not ad-hoc classes at call sites. */
export type ModalSize = 'md' | 'lg';

const SIZE_CLASSES: Record<ModalSize, string> = {
  md: 'max-w-md',
  lg: 'max-w-lg',
};

interface ModalProps {
  open: boolean;
  /** Accessible name for the dialog (announced to screen readers). */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Width cap; default 'md'. Both stay fluid (full width minus margin) on phones. */
  size?: ModalSize;
}

/**
 * Accessible modal dialog: portals to <body>, dims the page, closes on Escape or
 * an overlay click, and carries role="dialog" + aria-modal. Responsive — full
 * width with a margin on phones, capped on desktop. The caller composes the
 * content (header, form, actions) as children.
 */
export function Modal({ open, label, onClose, children, size = 'md' }: ModalProps) {
  // Only an overlay interaction that BOTH starts and ends on the overlay itself
  // dismisses the dialog. Without this, a click's target is the common ancestor of
  // press+release, so a text-selection drag that begins inside an input and releases
  // over the backdrop would resolve to the overlay and close the modal — losing the edit.
  const pressStartedOnOverlay = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onPointerDown={(event) => {
        pressStartedOnOverlay.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (pressStartedOnOverlay.current && event.target === event.currentTarget) onClose();
        pressStartedOnOverlay.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`w-full ${SIZE_CLASSES[size]} rounded-lg border border-edge bg-surface-1 shadow-xl`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
