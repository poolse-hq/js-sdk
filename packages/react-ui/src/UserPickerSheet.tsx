// UserPickerSheet — modal dialog for picking a user (direct chat) or
// a set of users plus a name (group). Same shape as the RN equivalent;
// `PoolseInbox` opens this from the "New chat" / "New group" buttons.
// Backdrop click, ESC, and the close button all dismiss.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from './Avatar.js';
import { PoolseIcon } from './PoolseIcon.js';

/** Minimal user shape the picker renders. Matches the RN InboxUser. */
export interface InboxUser {
  externalId: string;
  name: string;
  subtitle?: string;
  avatarUrl?: string | null;
}

export interface UserPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  users: InboxUser[];
  /** External_ids to hide from the list (typically `[me.external_id]`). */
  excludeIds?: string[];
  /** `single` → 1-tap to start a direct chat. `group` → multi-select + name input. */
  mode: 'single' | 'group';
  /** Fired in `single` mode once a user is tapped. */
  onPickDirect?: (externalId: string) => void;
  /** Fired in `group` mode once the user submits the form. */
  onCreateGroup?: (name: string, memberExternalIds: string[]) => void;
}

export function UserPickerSheet({
  visible,
  onClose,
  users,
  excludeIds = [],
  mode,
  onPickDirect,
  onCreateGroup,
}: UserPickerSheetProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Reset state every time the sheet opens — old selections from a
  // prior session leaking into a fresh open would be surprising.
  useEffect(() => {
    if (visible) {
      setQuery('');
      setSelected(new Set());
      setGroupName('');
      // Autofocus the search input after the modal mounts.
      const id = setTimeout(() => searchRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [visible]);

  // ESC closes.
  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const excluded = new Set(excludeIds);
    return users.filter((u) => {
      if (excluded.has(u.externalId)) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.externalId.toLowerCase().includes(q) ||
        (u.subtitle ?? '').toLowerCase().includes(q)
      );
    });
  }, [users, excludeIds, query]);

  if (!visible) return null;

  const toggle = (externalId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
  };

  const canSubmitGroup = mode === 'group' && selected.size >= 2 && groupName.trim().length > 0;

  return (
    <div
      className="poolse-modal"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'group' ? 'Create group' : 'New chat'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="poolse-modal__sheet">
        <header className="poolse-modal__header">
          <div className="poolse-modal__title">{mode === 'group' ? 'New group' : 'New chat'}</div>
          <button type="button" className="poolse-icon-btn" onClick={onClose} aria-label="Close">
            <PoolseIcon name="close" size={18} label={null} />
          </button>
        </header>

        <div className="poolse-modal__body">
          {mode === 'group' ? (
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name"
              className="poolse-input"
              aria-label="Group name"
            />
          ) : null}

          <div className="poolse-modal__search">
            <PoolseIcon name="search" size={16} label={null} />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or id…"
              className="poolse-input poolse-input--bare"
              aria-label="Search users"
            />
          </div>

          <ul className="poolse-user-picker" role="listbox" aria-label="Users">
            {filtered.length === 0 ? (
              <li className="poolse-user-picker__empty">No matching users.</li>
            ) : (
              filtered.map((u) => {
                const isSelected = selected.has(u.externalId);
                return (
                  <li
                    key={u.externalId}
                    role="option"
                    aria-selected={isSelected}
                    className={`poolse-user-picker__row${
                      isSelected ? ' poolse-user-picker__row--selected' : ''
                    }`}
                    onClick={() => {
                      if (mode === 'single') {
                        onPickDirect?.(u.externalId);
                        onClose();
                      } else {
                        toggle(u.externalId);
                      }
                    }}
                  >
                    <Avatar src={u.avatarUrl ?? null} name={u.name} size="md" />
                    <div className="poolse-user-picker__body">
                      <div className="poolse-user-picker__name">{u.name}</div>
                      {u.subtitle ? (
                        <div className="poolse-user-picker__subtitle">{u.subtitle}</div>
                      ) : null}
                    </div>
                    {mode === 'group' ? (
                      <span
                        className={`poolse-user-picker__check${
                          isSelected ? ' poolse-user-picker__check--on' : ''
                        }`}
                        aria-hidden="true"
                      >
                        {isSelected ? '✓' : ''}
                      </span>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        </div>

        {mode === 'group' ? (
          <footer className="poolse-modal__footer">
            <span className="poolse-modal__footer-hint">
              {selected.size} selected{selected.size < 2 ? ' (need 2+)' : ''}
            </span>
            <button
              type="button"
              className="poolse-btn poolse-btn--brand"
              disabled={!canSubmitGroup}
              onClick={() => {
                if (!canSubmitGroup) return;
                onCreateGroup?.(groupName.trim(), Array.from(selected));
                onClose();
              }}
            >
              Create group
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
