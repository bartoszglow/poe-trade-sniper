import { useEffect, useRef, useState } from 'react';
import type { DealBaselineHistoryEntry } from '@poe-sniper/shared';
import { useT } from '../i18n/i18n';
import {
  buildDealTrendGeometry,
  nearestTrendPointIndex,
  type DealTrendPoint,
} from '../lib/deal-trend';
import { formatExaltedAmount, formatSignedExaltedAmount } from '../lib/deal-watch-display';
import { formatRelativeMagnitude } from '../lib/relative-time';

/** Sparkline box height (px). Width follows the container via ResizeObserver. */
const SPARKLINE_HEIGHT = 72;
/** Inner padding so markers + their 2px surface ring stay inside the box. */
const SPARKLINE_PADDING = 8;

interface DealTrendSparklineProps {
  /** Newest-first, exactly as `GET …/deal-history` returns them. */
  entries: DealBaselineHistoryEntry[];
  /** Shared page tick so relative times age with the rest of the modal. */
  nowMs: number;
  /** Display-only divine rate for magnitude-aware readouts; null = exalted. */
  divinePriceExalted: number | null;
}

/**
 * Inline-SVG sparkline of the deal baseline history (plan 41 D-dw-12). Single
 * gold series (theme token) — no legend, per the single-series rule; re-derive
 * samples (cap moves) are the only marked points; values read via the hover
 * readout + the change-since-oldest label, both in ink tokens, never the series
 * color. The geometry is pure (lib/deal-trend.ts); this component only renders.
 */
export function DealTrendSparkline({
  entries,
  nowMs,
  divinePriceExalted,
}: DealTrendSparklineProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Geometry is computed in real pixel space (crisp 2px stroke at any modal
  // width) — so the box is measured, not scaled via preserveAspectRatio.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const observer = new ResizeObserver((observedEntries) => {
      const width = observedEntries[0]?.contentRect.width ?? 0;
      setContainerWidth(Math.round(width));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  if (entries.length === 0) {
    return <p className="text-xs text-ink-faint">{t('dealWatch.trendEmpty')}</p>;
  }

  const geometry =
    containerWidth > 0
      ? buildDealTrendGeometry(entries, {
          width: containerWidth,
          height: SPARKLINE_HEIGHT,
          padding: SPARKLINE_PADDING,
        })
      : null;

  const hoveredPoint: DealTrendPoint | null =
    geometry !== null && hoverIndex !== null ? (geometry.points[hoverIndex] ?? null) : null;
  const markedPoints = geometry?.points.filter((point) => point.rederived) ?? [];
  const lastPoint = geometry?.points[geometry.points.length - 1] ?? null;

  return (
    <div>
      <div ref={containerRef} className="w-full">
        {geometry && (
          <svg
            width={containerWidth}
            height={SPARKLINE_HEIGHT}
            role="img"
            aria-label={t('dealWatch.trendSince', {
              change: formatSignedExaltedAmount(geometry.changeExalted, divinePriceExalted),
              time: formatRelativeMagnitude(geometry.oldestComputedAt, nowMs),
            })}
            className="block rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-gold"
            // Keyboard parity for the pointer readout (review P2-5): arrows step
            // through samples, Escape/blur clears — same readout row renders both.
            tabIndex={0}
            onKeyDown={(keyboardEvent) => {
              if (keyboardEvent.key === 'ArrowRight' || keyboardEvent.key === 'ArrowLeft') {
                keyboardEvent.preventDefault();
                const step = keyboardEvent.key === 'ArrowRight' ? 1 : -1;
                setHoverIndex((currentIndex) => {
                  const lastIndex = geometry.points.length - 1;
                  if (currentIndex === null) return step === 1 ? 0 : lastIndex;
                  return Math.min(lastIndex, Math.max(0, currentIndex + step));
                });
              } else if (keyboardEvent.key === 'Escape') {
                setHoverIndex(null);
              }
            }}
            onBlur={() => setHoverIndex(null)}
            onPointerMove={(pointerEvent) => {
              const bounds = pointerEvent.currentTarget.getBoundingClientRect();
              setHoverIndex(
                nearestTrendPointIndex(geometry.points, pointerEvent.clientX - bounds.left),
              );
            }}
            onPointerLeave={() => setHoverIndex(null)}
          >
            {/* Area wash: the series hue at ~10% opacity, never a saturated block. */}
            {geometry.areaD !== '' && (
              <path d={geometry.areaD} fill="var(--color-gold)" fillOpacity={0.1} />
            )}
            {geometry.pathD !== '' && (
              <path
                d={geometry.pathD}
                fill="none"
                stroke="var(--color-gold)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {/* Re-derive samples (cap moves) — ≥8px markers with a 2px surface ring. */}
            {markedPoints.map((point) => (
              <circle
                key={`${point.computedAt}-rederived`}
                cx={point.x}
                cy={point.y}
                r={4}
                fill="var(--color-gold-bright)"
                stroke="var(--color-surface-1)"
                strokeWidth={2}
              />
            ))}
            {/* Newest sample end-dot (only when it isn't already a marker). */}
            {lastPoint && !lastPoint.rederived && (
              <circle
                cx={lastPoint.x}
                cy={lastPoint.y}
                r={3}
                fill="var(--color-gold)"
                stroke="var(--color-surface-1)"
                strokeWidth={2}
              />
            )}
            {hoveredPoint && (
              <circle
                cx={hoveredPoint.x}
                cy={hoveredPoint.y}
                r={4.5}
                fill="var(--color-gold-bright)"
                stroke="var(--color-surface-1)"
                strokeWidth={2}
              />
            )}
          </svg>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        {geometry && (
          <span className="text-ink-muted">
            {hoveredPoint
              ? `${formatExaltedAmount(hoveredPoint.amountExalted, divinePriceExalted)} · ${t(
                  'dealWatch.checkedAgo',
                  { time: formatRelativeMagnitude(hoveredPoint.computedAt, nowMs) },
                )}`
              : t('dealWatch.trendSince', {
                  change: formatSignedExaltedAmount(geometry.changeExalted, divinePriceExalted),
                  time: formatRelativeMagnitude(geometry.oldestComputedAt, nowMs),
                })}
          </span>
        )}
        {markedPoints.length > 0 && (
          <span className="flex items-center gap-1.5 text-ink-faint">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-gold-bright" />
            {t('dealWatch.trendRederived')}
          </span>
        )}
      </div>
    </div>
  );
}
