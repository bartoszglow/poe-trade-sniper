import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { GripVertical } from 'lucide-react';

/**
 * Vertical panel divider (#34): a slim grab strip with a grip pill centered on
 * the split line. Reports raw pointer positions — the owner turns them into a
 * width and clamps. Keyboard-accessible (role separator, arrow keys resize,
 * double-click / Enter resets).
 */
export function ResizeHandle({
  ariaLabel,
  valueNow,
  valueMin,
  valueMax,
  onDragTo,
  onDragEnd,
  onKeyStep,
  onReset,
}: {
  ariaLabel: string;
  valueNow: number;
  valueMin: number;
  valueMax: number;
  /** Pointer is at this clientX while dragging — preview the new split. */
  onDragTo: (clientX: number) => void;
  /** Drag released — commit the previewed split. */
  onDragEnd: () => void;
  /** Arrow-key resize; direction is the arrow pressed. */
  onKeyStep: (direction: 'left' | 'right') => void;
  /** Double-click (or Enter) restores the default split. */
  onReset: () => void;
}) {
  const [dragging, setDragging] = useState(false);

  function handlePointerDown(pointerEvent: PointerEvent<HTMLDivElement>): void {
    pointerEvent.preventDefault();
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
    setDragging(true);
  }

  function handlePointerMove(pointerEvent: PointerEvent<HTMLDivElement>): void {
    if (dragging) onDragTo(pointerEvent.clientX);
  }

  function handlePointerUp(pointerEvent: PointerEvent<HTMLDivElement>): void {
    if (!dragging) return;
    pointerEvent.currentTarget.releasePointerCapture(pointerEvent.pointerId);
    setDragging(false);
    onDragEnd();
  }

  function handleKeyDown(keyEvent: KeyboardEvent<HTMLDivElement>): void {
    if (keyEvent.key === 'ArrowLeft' || keyEvent.key === 'ArrowRight') {
      keyEvent.preventDefault();
      onKeyStep(keyEvent.key === 'ArrowLeft' ? 'left' : 'right');
    } else if (keyEvent.key === 'Enter') {
      keyEvent.preventDefault();
      onReset();
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={valueNow}
      aria-valuemin={valueMin}
      aria-valuemax={valueMax}
      tabIndex={0}
      title={ariaLabel}
      className="group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none select-none focus-visible:outline-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    >
      {/* The split line lights up while grabbed / hovered / focused. */}
      <span
        className={`absolute inset-y-0 left-1.5 w-px transition-colors ${
          dragging
            ? 'bg-gold/70'
            : 'bg-transparent group-hover:bg-gold/40 group-focus-visible:bg-gold/40'
        }`}
      />
      {/* The grip pill, centered on the line. */}
      <span
        className={`absolute top-1/2 left-1.5 -translate-x-1/2 -translate-y-1/2 rounded border py-1 transition-colors ${
          dragging
            ? 'border-gold/70 bg-surface-2 text-ink'
            : 'border-edge bg-surface-2 text-ink-faint group-hover:text-ink group-focus-visible:border-gold/70 group-focus-visible:text-ink'
        }`}
      >
        <GripVertical className="h-4 w-3" />
      </span>
    </div>
  );
}
