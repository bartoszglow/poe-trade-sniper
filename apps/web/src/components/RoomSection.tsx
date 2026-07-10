import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { RoomDeleteMode, RoomInfo, SearchRuntimeInfo } from '@poe-sniper/shared';
import { roomDragId, roomDropId } from '../lib/search-layout-dnd';
import { shouldRowClickExpand } from '../lib/row-expand';
import { useExpandTransition } from '../hooks/usePanelExpansion';
import { useT, useTn } from '../i18n/i18n';
import { ApiError } from '../lib/api';
import { Badge } from './Badge';
import { ConfirmDialog } from './ConfirmDialog';
import { IconButton } from './IconButton';
import { Switch } from './Switch';
import { TextInput } from './TextInput';

/**
 * A room on the Searches view (#33): a named, collapsible, draggable group of
 * searches. Presentational — members render via `renderSearch` so the page
 * keeps owning the SearchRow wiring. Deleting a NON-empty room always asks the
 * operator (D-room-2: release members vs delete them); an empty room deletes
 * straight away (both modes are equivalent then).
 */
export function RoomSection({
  room,
  members,
  collapsed,
  highlighted,
  startRenaming = false,
  forceCollapsed = false,
  renderSearch,
  detectionPaused = false,
  onRename,
  onToggleCollapsed,
  onSetEnabled,
  onDelete,
}: {
  room: RoomInfo;
  members: SearchRuntimeInfo[];
  /**
   * The VISUAL collapse state, owned by the page — usually the persisted
   * `room.collapsed`, but a fresh member hit auto-expands a collapsed room for
   * the highlight window (D-room-3), so the two can differ.
   */
  collapsed: boolean;
  /** Gold glow while a member's hit is fresh and the room is normally collapsed. */
  highlighted: boolean;
  /** Open the name editor immediately (right after creation). */
  startRenaming?: boolean;
  /**
   * Render collapsed regardless of anything else — the page sets this while a
   * ROOM block is being dragged, so every top-level slot is compact and easy
   * to target. Purely visual; `room.collapsed` is untouched.
   */
  forceCollapsed?: boolean;
  renderSearch: (search: SearchRuntimeInfo) => ReactNode;
  onRename: (name: string) => Promise<void>;
  onToggleCollapsed: () => Promise<void>;
  /** Global detection pause — the master switch shows the paused (info) tone,
   *  mirroring the per-row ACTIVE switch. */
  detectionPaused?: boolean;
  /** Master switch (D-room-1): sets `enabled` on EVERY member search. */
  onSetEnabled: (enabled: boolean) => Promise<void>;
  onDelete: (mode: RoomDeleteMode) => Promise<void>;
}) {
  const t = useT();
  const tn = useTn();
  const [renaming, setRenaming] = useState(startRenaming);
  const [draftName, setDraftName] = useState(room.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: roomDragId(room.id),
  });
  const { setNodeRef: setEmptyDropZoneRef, isOver: isOverEmptyDropZone } = useDroppable({
    id: roomDropId(room.id),
  });

  async function run(action: () => Promise<void>) {
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError && error.userFacing ? error.message : t('common.requestFailed'),
      );
    }
  }

  function openRename(): void {
    setDraftName(room.name);
    setRenaming(true);
  }

  function commitRename(): void {
    const name = draftName.trim();
    setRenaming(false);
    if (!name || name === room.name) return;
    void run(() => onRename(name));
  }

  const CollapseIcon = collapsed ? ChevronRight : ChevronDown;
  // Animate expand/collapse like the search detail panel (grid 0fr→1fr, ~200ms,
  // reduced-motion aware). `forceCollapsed` (transient, drag-over) rides the same
  // transition — the member list mounts through the collapse so it can animate.
  const roomOpen = !collapsed && !forceCollapsed;
  const { rendered: membersRendered, shown: membersShown } = useExpandTransition(roomOpen);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border transition-colors ${
        isDragging
          ? 'border-gold/40 opacity-40'
          : highlighted
            ? 'border-gold/60 bg-gold/5'
            : 'border-edge bg-surface-0'
      }`}
    >
      {/* D-42-1's guard, reused: the whole header toggles collapse — except
          interactive controls (rename, switch, delete, drag handle) and
          portal/text-selection clicks, same exclusion rule as the search row. */}
      <div
        className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-2.5"
        onClick={(clickEvent) => {
          if (
            shouldRowClickExpand(clickEvent.currentTarget, clickEvent.target, window.getSelection())
          ) {
            void run(onToggleCollapsed);
          }
        }}
      >
        <button
          type="button"
          data-no-expand
          aria-label={t('rooms.reorder')}
          title={t('rooms.reorder')}
          className="shrink-0 cursor-grab touch-none text-ink-faint transition-colors hover:text-ink active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <IconButton
          variant="ghost"
          aria-label={collapsed ? t('rooms.expand') : t('rooms.collapse')}
          title={collapsed ? t('rooms.expand') : t('rooms.collapse')}
          aria-expanded={!collapsed}
          onClick={() => void run(onToggleCollapsed)}
        >
          <CollapseIcon className="h-4 w-4" />
        </IconButton>
        {renaming ? (
          <TextInput
            autoFocus
            value={draftName}
            aria-label={t('rooms.nameLabel')}
            onChange={(changeEvent) => setDraftName(changeEvent.target.value)}
            onBlur={commitRename}
            onKeyDown={(keyEvent) => {
              if (keyEvent.key === 'Enter') commitRename();
              if (keyEvent.key === 'Escape') setRenaming(false);
            }}
            className="max-w-56"
          />
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-ink">{room.name}</span>
            <IconButton
              variant="ghost"
              aria-label={t('rooms.rename')}
              title={t('rooms.rename')}
              onClick={openRename}
            >
              <Pencil className="h-3 w-3" />
            </IconButton>
          </span>
        )}
        <Badge tone="neutral">{tn('rooms.memberCount', members.length)}</Badge>
        <div className="flex-1" />
        {errorMessage && <span className="text-xs text-danger">{errorMessage}</span>}
        {/* Master switch: bound to the room's OWN gate (room.enabled), a single
            source of truth — it never overwrites members' individual toggles, so
            an individually-paused member stays paused through a room toggle. The
            info tone mirrors the per-row ACTIVE switch under a global pause. */}
        <span
          className="flex items-center gap-1.5 text-xs text-ink-muted"
          title={detectionPaused ? t('engineStatusDesc.paused') : undefined}
        >
          <Switch
            checked={room.enabled}
            disabled={members.length === 0}
            onChange={(enabled) => void run(() => onSetEnabled(enabled))}
            label={t('rooms.activeFor', { name: room.name })}
            tone={detectionPaused ? 'info' : 'gold'}
          />
          {t('searches.activeToggle')}
        </span>
        <IconButton
          variant="danger"
          aria-label={t('rooms.delete', { name: room.name })}
          title={t('rooms.delete', { name: room.name })}
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
      {/* Animated expand/collapse: grid 0fr→1fr height transition, matching the
          search detail panel (D-42-1). */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          membersShown ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          {membersRendered && (
            <SortableContext
              items={members.map((member) => member.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-2 border-t border-edge p-3">
                {members.map((member) => renderSearch(member))}
                {members.length === 0 && (
                  <li
                    ref={setEmptyDropZoneRef}
                    className={`rounded-lg border border-dashed px-4 py-3 text-center text-sm transition-colors ${
                      isOverEmptyDropZone ? 'border-gold/70 text-ink' : 'border-edge text-ink-faint'
                    }`}
                  >
                    {t('rooms.empty')}
                  </li>
                )}
              </ul>
            </SortableContext>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmingDelete}
        title={t('rooms.deleteTitle')}
        body={
          members.length === 0
            ? t('rooms.deleteEmptyBody', { name: room.name })
            : tn('rooms.deleteBody', members.length, { name: room.name })
        }
        onClose={() => setConfirmingDelete(false)}
        actions={
          members.length === 0
            ? [
                {
                  id: 'delete',
                  label: t('common.delete'),
                  onSelect: () => void run(() => onDelete('release')),
                },
              ]
            : [
                {
                  id: 'release',
                  label: t('rooms.deleteRelease'),
                  variant: 'primary',
                  onSelect: () => void run(() => onDelete('release')),
                },
                {
                  id: 'delete-searches',
                  label: t('rooms.deleteWithSearches'),
                  onSelect: () => void run(() => onDelete('delete-searches')),
                },
              ]
        }
      />
    </li>
  );
}
