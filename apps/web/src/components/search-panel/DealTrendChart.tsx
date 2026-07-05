import { useEffect, useRef, useState } from 'react';
import type { DealBaselineHistoryEntry } from '@poe-sniper/shared';
import { useT, useTn } from '../../i18n/i18n';
import {
  buildDealTrendGeometry,
  nearestTrendPointIndex,
  type DealTrendPoint,
} from '../../lib/deal-trend';
import { formatExaltedAmount, formatSignedExaltedAmount } from '../../lib/deal-watch-display';
import { formatRelativeMagnitude } from '../../lib/relative-time';

/** Full-width history chart box (px) — roomier than the old modal sparkline. */
const CHART_HEIGHT = 172;
/** Inner padding so markers + their 2px surface ring stay inside the box. */
const CHART_PADDING = 10;
/** Left inset reserving room for the y-axis tick labels. */
const CHART_PADDING_LEFT = 56;
/** Bottom inset reserving room for the time-axis tick labels. */
const CHART_PADDING_BOTTOM = 26;
/** Keep edge time labels (anchor: middle) inside the plot box. */
const TIME_LABEL_CLEARANCE = 16;

interface DealTrendChartProps {
  /** Newest-first, exactly as `GET …/deal-history` returns them. */
  entries: DealBaselineHistoryEntry[];
  /** Shared panel tick so relative times age with the rest of the panel. */
  nowMs: number;
  /** Display-only divine rate for magnitude-aware readouts; null = exalted. */
  divinePriceExalted: number | null;
}

/**
 * The unified panel's baseline-history chart (plan 42) — the modal sparkline
 * grown to full width: recessive y-axis gridlines with ink-faint labels, a
 * crosshair + floating tooltip (value · age · re-derive note), ringed markers
 * on cap moves, keyboard stepping, and a visually-hidden table fallback.
 * Single gold series — no legend box (the card title names it); geometry stays
 * pure in lib/deal-trend.ts.
 */
export function DealTrendChart({ entries, nowMs, divinePriceExalted }: DealTrendChartProps) {
  const t = useT();
  const tn = useTn();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Geometry in real pixel space (crisp 2px stroke at any panel width) — the
  // box is measured, not scaled via preserveAspectRatio.
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

  // A one-point series is not a chart: a lone dot in an empty plot with a
  // "0 ex over 2m · 1 sample" header reads as broken. Show a compact line
  // until a second market check gives the trend something to draw.
  if (entries.length < 2) {
    return <p className="text-xs text-ink-faint">{t('dealWatch.trendGrowing')}</p>;
  }

  const geometry =
    containerWidth > 0
      ? buildDealTrendGeometry(
          entries,
          {
            width: containerWidth,
            height: CHART_HEIGHT,
            padding: CHART_PADDING,
            paddingLeft: CHART_PADDING_LEFT,
            paddingBottom: CHART_PADDING_BOTTOM,
          },
          divinePriceExalted,
        )
      : null;

  const hoveredPoint: DealTrendPoint | null =
    geometry !== null && hoverIndex !== null ? (geometry.points[hoverIndex] ?? null) : null;
  const markedPoints = geometry?.points.filter((point) => point.rederived) ?? [];
  const lastPoint = geometry?.points[geometry.points.length - 1] ?? null;

  return (
    <div>
      {geometry && (
        <div className="mb-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
          <span className="text-ink-muted">
            {t('dealWatch.trendSince', {
              change: formatSignedExaltedAmount(geometry.changeExalted, divinePriceExalted),
              time: formatRelativeMagnitude(geometry.oldestComputedAt, nowMs),
            })}
          </span>
          <span className="text-ink-faint">{tn('searchPanel.samples', entries.length)}</span>
          {markedPoints.length > 0 && (
            <span className="flex items-center gap-1.5 text-ink-faint">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full border-2 border-surface-1 bg-gold-bright"
              />
              {t('dealWatch.trendRederived')}
            </span>
          )}
        </div>
      )}
      <div ref={containerRef} className="relative w-full">
        {geometry && (
          <>
            <svg
              width={containerWidth}
              height={CHART_HEIGHT}
              role="img"
              aria-label={t('dealWatch.trendSince', {
                change: formatSignedExaltedAmount(geometry.changeExalted, divinePriceExalted),
                time: formatRelativeMagnitude(geometry.oldestComputedAt, nowMs),
              })}
              className="block rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-gold"
              // Keyboard parity for the pointer readout: arrows step through
              // samples, Escape/blur clears — tooltip renders for both.
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
              {/* Recessive grid: whole-unit rows + ink-faint labels, never louder than data. */}
              {geometry.ticks.map((tick) => (
                <g key={tick.valueExalted}>
                  <line
                    x1={geometry.plotLeft}
                    x2={geometry.plotRight}
                    y1={tick.y}
                    y2={tick.y}
                    stroke="var(--color-edge)"
                    strokeWidth={1}
                  />
                  <text
                    x={geometry.plotLeft - 6}
                    y={tick.y + 3}
                    textAnchor="end"
                    fontSize={10}
                    fill="var(--color-ink-faint)"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}
              {/* Time scale: adaptive local wall-clock ticks along the bottom. */}
              {geometry.timeTicks.map((tick) => (
                <g key={tick.ms}>
                  <line
                    x1={tick.x}
                    x2={tick.x}
                    y1={geometry.plotBottom}
                    y2={geometry.plotBottom + 4}
                    stroke="var(--color-edge-strong)"
                    strokeWidth={1}
                  />
                  <text
                    x={Math.min(
                      geometry.plotRight - TIME_LABEL_CLEARANCE,
                      Math.max(geometry.plotLeft + TIME_LABEL_CLEARANCE, tick.x),
                    )}
                    y={CHART_HEIGHT - 8}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--color-ink-faint)"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}
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
                <>
                  <line
                    x1={hoveredPoint.x}
                    x2={hoveredPoint.x}
                    y1={CHART_PADDING}
                    y2={geometry.plotBottom}
                    stroke="var(--color-edge-strong)"
                    strokeWidth={1}
                  />
                  <circle
                    cx={hoveredPoint.x}
                    cy={hoveredPoint.y}
                    r={4.5}
                    fill="var(--color-gold-bright)"
                    stroke="var(--color-surface-1)"
                    strokeWidth={2}
                  />
                </>
              )}
            </svg>
            {hoveredPoint && (
              <div
                // Edge-aware anchor: the panel's animation wrapper is
                // overflow-hidden, so a centered tooltip clips at the first
                // (leftmost) and newest (rightmost) points — the two most
                // hovered. Anchor left near the left edge, right near the right.
                className={`pointer-events-none absolute z-10 rounded-md border border-edge-strong bg-surface-3 px-2 py-1 text-xs whitespace-nowrap text-ink ${
                  hoveredPoint.x < geometry.plotLeft + 60
                    ? 'translate-x-0'
                    : hoveredPoint.x > geometry.plotRight - 60
                      ? '-translate-x-full'
                      : '-translate-x-1/2'
                }`}
                style={{ left: hoveredPoint.x, top: Math.max(0, hoveredPoint.y - 34) }}
              >
                <b className="font-semibold text-gold-bright">
                  {formatExaltedAmount(hoveredPoint.amountExalted, divinePriceExalted)}
                </b>
                {' · '}
                {t('dealWatch.checkedAgo', {
                  time: formatRelativeMagnitude(hoveredPoint.computedAt, nowMs),
                })}
                {hoveredPoint.rederived && (
                  <span className="text-warn"> · {t('searchPanel.capMoved')}</span>
                )}
              </div>
            )}
          </>
        )}
        {/* Keyboard stepping announces the focused sample for screen readers —
            the svg subtree is aria-hidden (role=img), so without this the
            arrow keys would move a silent cursor. */}
        <p className="sr-only" aria-live="polite">
          {hoveredPoint
            ? `${formatExaltedAmount(hoveredPoint.amountExalted, divinePriceExalted)} · ${t(
                'dealWatch.checkedAgo',
                { time: formatRelativeMagnitude(hoveredPoint.computedAt, nowMs) },
              )}${hoveredPoint.rederived ? ` · ${t('searchPanel.capMoved')}` : ''}`
            : ''}
        </p>
      </div>
      {/* Table fallback: the same series for screen readers / forced-colors. */}
      <table className="sr-only">
        <caption>{t('searchPanel.history')}</caption>
        <thead>
          <tr>
            <th>{t('searchPanel.tableTime')}</th>
            <th>{t('searchPanel.tableValue')}</th>
            <th>{t('searchPanel.capMoved')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.computedAt}>
              <td>{entry.computedAt}</td>
              <td>{formatExaltedAmount(entry.amountExalted, divinePriceExalted)}</td>
              <td>{entry.rederived ? '✓' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
