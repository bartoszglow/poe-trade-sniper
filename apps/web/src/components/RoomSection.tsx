import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { RoomDeleteMode, RoomInfo, SearchRuntimeInfo } from '@poe-sniper/shared';
import { roomDragId, roomDropId } from '../lib/search-layout-dnd';
import { useT, useTn } from '../i18n/i18n';
import { ApiError } from '../lib/api';
import { Badge } from './Badge';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Modal } from './Modal';
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
  highlighted,
  startRenaming = false,
  forceCollapsed = false,
  renderSearch,
  onRename,
  onToggleCollapsed,
  onDelete,
}: {
  room: RoomInfo;
  members: SearchRuntimeInfo[];
  /** Gold glow while collapsed and a hidden member just hit. */
  highlighted: boolean;
  /** Open the name editor immediately (right after creation). */
  startRenaming?: boolean;
  /**
   * Render collapsed regardless of the persisted state — the page sets this
   * while a ROOM block is being dragged, so every top-level slot is compact
   * and easy to target. Purely visual; `room.collapsed` is untouched.
   */
  forceCollapsed?: boolean;
  renderSearch: (search: SearchRuntimeInfo) => ReactNode;
  onRename: (name: string) => Promise<void>;
  onToggleCollapsed: () => Promise<void>;
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
      setErrorMessage(error instanceof ApiError ? error.message : t('common.requestFailed'));
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

  const CollapseIcon = room.collapsed ? ChevronRight : ChevronDown;

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
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <button
          type="button"
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
          aria-label={room.collapsed ? t('rooms.expand') : t('rooms.collapse')}
          title={room.collapsed ? t('rooms.expand') : t('rooms.collapse')}
          aria-expanded={!room.collapsed}
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
        <IconButton
          variant="danger"
          aria-label={t('rooms.delete', { name: room.name })}
          title={t('rooms.delete', { name: room.name })}
          onClick={() => {
            if (members.length === 0) {
              void run(() => onDelete('release'));
            } else {
              setConfirmingDelete(true);
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
      {!room.collapsed && !forceCollapsed && (
        <SortableContext
          items={members.map((member) => member.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-2 border-t border-edge p-3 pl-8">
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
      <Modal
        open={confirmingDelete}
        label={t('rooms.deleteTitle')}
        onClose={() => setConfirmingDelete(false)}
      >
        <div className="border-b border-edge px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink">{t('rooms.deleteTitle')}</h2>
        </div>
        <p className="max-w-md p-4 text-sm text-ink-muted">
          {tn('rooms.deleteBody', members.length, { name: room.name })}
        </p>
        <div className="flex flex-wrap justify-end gap-2 border-t border-edge px-4 py-2.5">
          <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setConfirmingDelete(false);
              void run(() => onDelete('release'));
            }}
          >
            {t('rooms.deleteRelease')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmingDelete(false);
              void run(() => onDelete('delete-searches'));
            }}
          >
            {t('rooms.deleteWithSearches')}
          </Button>
        </div>
      </Modal>
    </li>
  );
}
