import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'gold' | 'ok' | 'danger' | 'info';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-ink-muted',
  gold: 'bg-gold/15 text-gold-bright',
  ok: 'bg-ok/15 text-ok',
  danger: 'bg-danger/15 text-danger',
  info: 'bg-info/15 text-info',
};

interface BadgeProps {
  tone: BadgeTone;
  children: ReactNode;
}

/** Atomic badge — tones are an enum, never ad-hoc colors at call sites. */
export function Badge({ tone, children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[0.7rem] font-medium tracking-wide uppercase ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
