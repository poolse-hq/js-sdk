// PoolseInbox — composed list + detail shell for the web SDK. On wide
// viewports renders a Slack-style two-column layout (list on the
// left, active conversation on the right). On narrow viewports
// (≤720px) the active conversation slides over the list and `onBack`
// pops back to the list — matches the RN PoolseInbox feel.
//
// Mirror of the React Native PoolseInbox so customers can pass the
// same `users` directory + `labelFor` / `avatarFor` resolvers to both
// platforms. Imperative `open / openDirect / openGroup /
// promptNewChat / promptNewGroup / close` API is identical too.

import type { Conversation, Uuid } from '@poolse/sdk';
import { useConversations, useMe } from '@poolse/react';
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ChatHeader } from './ChatHeader.js';
import { ConversationList } from './ConversationList.js';
import { ConversationView } from './ConversationView.js';
import { GroupDetailsSheet } from './GroupDetailsSheet.js';
import { PoolseIcon } from './PoolseIcon.js';
import { UserPickerSheet, type InboxUser } from './UserPickerSheet.js';

export type { InboxUser } from './UserPickerSheet.js';

export interface PoolseInboxProps {
  /** Header title above the conversation list. Defaults to "Chats". */
  title?: string;
  /**
   * The tenant's user directory. When provided, the inbox shows
   * "New chat" + "New group" buttons in the header. Omit if you
   * don't want the built-in picker UI (e.g. you start chats from
   * elsewhere via the imperative `openDirect()` API).
   */
  users?: InboxUser[];
  /** Display-name resolver for sender labels, chat header titles, conversation rows. */
  labelFor?: (externalId: string) => string;
  /** Avatar URL resolver — same role. */
  avatarFor?: (externalId: string) => string | null;
  /** Right-side slot in the list header (typical use: logout / settings). */
  renderRightAction?: () => ReactNode;
  /** Custom row renderer — receives conv + caller external_id + selected. */
  renderConversationRow?: (
    conv: Conversation,
    callerExternalId: string | null,
    selected: boolean,
  ) => ReactNode;
  /** Custom empty state when the list is empty. */
  emptyState?: ReactNode | string;
}

export interface PoolseInboxHandle {
  /** Open a known conversation (e.g. from a deep link / push tap). */
  open: (conversationId: Uuid) => void;
  /**
   * Open (or create) a direct conversation with the given external_id.
   * The backend dedupes per pair — returns the existing conversation
   * if one already exists.
   */
  openDirect: (externalId: string) => Promise<void>;
  /** Open (or create) a group conversation. */
  openGroup: (name: string, memberExternalIds: string[]) => Promise<void>;
  /** Open the built-in "new chat" picker programmatically. */
  promptNewChat: () => void;
  /** Open the built-in "new group" picker programmatically. */
  promptNewGroup: () => void;
  /** Pop back to the conversation list. */
  close: () => void;
}

/**
 * Drop-in inbox screen. Two-column on wide viewports, push-pane on
 * mobile-web. Picker sheets for "New chat" / "New group" appear when
 * `users` is provided; otherwise the dev wires those flows themselves
 * via `openDirect` / `openGroup` on the ref.
 */
export const PoolseInbox = forwardRef<PoolseInboxHandle, PoolseInboxProps>(function PoolseInbox(
  {
    title = 'Chats',
    users,
    labelFor,
    avatarFor,
    renderRightAction,
    renderConversationRow,
    emptyState,
  },
  ref,
) {
  const { me } = useMe();
  const meExternalId = me?.external_id ?? null;
  const { conversations, create, unreadCounts } = useConversations();

  const [activeId, setActiveId] = useState<Uuid | null>(null);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groupDetailsOpen, setGroupDetailsOpen] = useState(false);

  const openDirect = useCallback(
    async (externalId: string) => {
      const conv = await create({
        type: 'direct',
        member_external_ids: [externalId],
      });
      setActiveId(conv.id);
    },
    [create],
  );

  const openGroup = useCallback(
    async (name: string, memberExternalIds: string[]) => {
      const conv = await create({
        type: 'group',
        name,
        member_external_ids: memberExternalIds,
      });
      setActiveId(conv.id);
    },
    [create],
  );

  useImperativeHandle(
    ref,
    () => ({
      open: setActiveId,
      openDirect,
      openGroup,
      promptNewChat: () => setUserPickerOpen(true),
      promptNewGroup: () => setGroupPickerOpen(true),
      close: () => setActiveId(null),
    }),
    [openDirect, openGroup],
  );

  const renderRow = useMemo(() => {
    if (!renderConversationRow) return undefined;
    return (conv: Conversation, selected: boolean) =>
      renderConversationRow(conv, meExternalId, selected);
  }, [renderConversationRow, meExternalId]);

  // Active conversation lookup — used by ChatHeader to render the
  // right back-arrow visibility on mobile.
  const activeConv = activeId ? (conversations.find((c) => c.id === activeId) ?? null) : null;
  const isGroup = activeConv?.type === 'group';

  return (
    <div className={`poolse-inbox${activeId ? ' poolse-inbox--detail-open' : ''}`}>
      {/* LIST PANE */}
      <aside className="poolse-inbox__list-pane">
        <header className="poolse-inbox__list-header">
          <div className="poolse-inbox__list-title">{title}</div>
          <div className="poolse-inbox__list-actions">
            {users ? (
              <>
                <button
                  type="button"
                  className="poolse-icon-btn"
                  onClick={() => setUserPickerOpen(true)}
                  aria-label="New chat"
                >
                  <PoolseIcon name="compose" size={18} label={null} />
                </button>
                <button
                  type="button"
                  className="poolse-icon-btn"
                  onClick={() => setGroupPickerOpen(true)}
                  aria-label="New group"
                >
                  <PoolseIcon name="users" size={18} label={null} />
                </button>
              </>
            ) : null}
            {renderRightAction?.()}
          </div>
        </header>

        <div className="poolse-inbox__list-scroll">
          <ConversationList
            selectedId={activeId ?? null}
            onSelect={(c) => setActiveId(c.id)}
            conversations={conversations}
            unreadCounts={unreadCounts}
            {...(labelFor ? { labelFor } : {})}
            {...(avatarFor ? { avatarFor } : {})}
            {...(renderRow ? { renderItem: renderRow } : {})}
            {...(emptyState !== undefined ? { emptyState } : {})}
          />
        </div>
      </aside>

      {/* DETAIL PANE */}
      <section className="poolse-inbox__detail-pane">
        {activeId ? (
          <>
            <ChatHeader
              conversationId={activeId}
              onBack={() => setActiveId(null)}
              {...(labelFor ? { labelFor } : {})}
              {...(avatarFor ? { avatarFor } : {})}
              {...(isGroup ? { onMembersPress: () => setGroupDetailsOpen(true) } : {})}
            />
            <ConversationView
              key={activeId}
              conversationId={activeId}
              {...(labelFor ? { labelFor } : {})}
            />
          </>
        ) : (
          <div className="poolse-inbox__detail-empty">
            <PoolseIcon name="messages" size={32} label={null} />
            <div className="poolse-inbox__detail-empty-title">Pick a conversation</div>
          </div>
        )}
      </section>

      {users ? (
        <UserPickerSheet
          visible={userPickerOpen}
          onClose={() => setUserPickerOpen(false)}
          users={users}
          excludeIds={meExternalId ? [meExternalId] : []}
          mode="single"
          onPickDirect={(externalId) => {
            void openDirect(externalId);
          }}
        />
      ) : null}

      {users ? (
        <UserPickerSheet
          visible={groupPickerOpen}
          onClose={() => setGroupPickerOpen(false)}
          users={users}
          excludeIds={meExternalId ? [meExternalId] : []}
          mode="group"
          onCreateGroup={(name, ids) => {
            void openGroup(name, ids);
          }}
        />
      ) : null}

      {activeId && isGroup ? (
        <GroupDetailsSheet
          visible={groupDetailsOpen}
          onClose={() => setGroupDetailsOpen(false)}
          conversationId={activeId}
          {...(labelFor ? { labelFor } : {})}
          {...(avatarFor ? { avatarFor } : {})}
        />
      ) : null}
    </div>
  );
});
