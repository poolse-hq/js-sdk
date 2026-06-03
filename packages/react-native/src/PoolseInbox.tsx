import type { Conversation, Uuid } from '@poolse/sdk';
import { useConversations, useMe } from '@poolse/react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  Easing,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { ChatHeader } from './ChatHeader.js';
import { ConversationList } from './ConversationList.js';
import { ConversationView } from './ConversationView.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { Avatar } from './primitives/Avatar.js';
import { UserPickerSheet, type InboxUser } from './internal/UserPickerSheet.js';
import { usePoolseTheme } from './theme/PoolseTheme.js';

export type { InboxUser } from './internal/UserPickerSheet.js';

// Height of the ChatHeader we render above ConversationView in the
// detail pane. Hardcoded because ChatHeader has fixed vertical
// padding (10 + 36 content + 10 ≈ 56). If you change ChatHeader's
// padding, bump this constant.
const CHAT_HEADER_HEIGHT = 56;

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

  /** Display-name resolver for sender labels / chat header titles. */
  labelFor?: (externalId: string) => string;
  /** Avatar URL resolver. */
  avatarFor?: (externalId: string) => string | null;

  /**
   * Right-side slot in the header — typical use is a logout / settings
   * button. Rendered after the New-chat / New-group buttons.
   */
  renderRightAction?: () => ReactNode;

  /**
   * Custom row renderer for the conversation list. Receives the
   * conversation + the caller's external_id (resolved via `useMe`)
   * so you can branch on direct-vs-group display.
   */
  renderConversationRow?: (
    conv: Conversation,
    callerExternalId: string | null,
    selected: boolean,
  ) => ReactNode;

  /** Custom empty state when the list is empty. */
  emptyState?: ReactNode | string;

  /** Forwarded to `<ConversationView>` — set if you have a nav header above. */
  keyboardOffset?: number;
}

export interface PoolseInboxHandle {
  /** Open a known conversation (e.g. from a deep link / push tap). */
  open: (conversationId: Uuid) => void;
  /**
   * Open (or create) a direct conversation with the given external_id.
   * The backend dedupes per pair — returns the existing conversation
   * if one already exists. Use this from a "Message" button on your
   * user profile screens.
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
 * Drop-in inbox screen: scrollable list of conversations + chat
 * detail, with an iOS-style slide animation between them. Manages
 * its own navigation stack (no react-navigation needed). Picker
 * sheets for "New chat" / "New group" appear when `users` is
 * provided; otherwise the dev wires those flows themselves and
 * uses the imperative ref to open conversations.
 *
 * For the "Message" button on a user profile screen, hold a ref to
 * the inbox and call `inboxRef.current?.openDirect(externalId)`.
 */
export const PoolseInbox = forwardRef<PoolseInboxHandle, PoolseInboxProps>(
  function PoolseInbox(props, ref) {
    const {
      title = 'Chats',
      users,
      labelFor,
      avatarFor,
      renderRightAction,
      renderConversationRow,
      emptyState,
      keyboardOffset = 0,
    } = props;

    const theme = usePoolseTheme();
    const { width: screenWidth } = useWindowDimensions();
    const { me } = useMe();
    const {
      conversations,
      create,
      unreadCounts,
      markConversationRead,
      refetch: refetchConversations,
    } = useConversations();
    const meExternalId = me?.external_id ?? null;
    // KAV.frame.y is measured relative to the SafeAreaView's
    // coordinate space (the SafeAreaView already absorbs the
    // safe-area-top inset). So the only chrome we need to compensate
    // for in keyboardVerticalOffset is our own ChatHeader above the
    // KAV. Adding insets.top on top double-counts and pushes the
    // composer way too far above the keyboard.
    const detailKeyboardOffset = CHAT_HEADER_HEIGHT;

    const [activeId, setActiveId] = useState<Uuid | null>(null);
    const [userPickerOpen, setUserPickerOpen] = useState(false);
    const [groupPickerOpen, setGroupPickerOpen] = useState(false);

    const slide = useRef(new Animated.Value(0)).current;
    // Flipped to true while the user is dragging the detail pane via
    // the edge-swipe gesture so the activeId-driven timing animation
    // doesn't fight the finger.
    const draggingRef = useRef(false);
    useEffect(() => {
      if (draggingRef.current) return;
      Animated.timing(slide, {
        toValue: activeId ? 1 : 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }, [activeId, slide]);

    const listTransform = slide.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -Math.round(screenWidth * 0.25)],
    });
    const detailTransform = slide.interpolate({
      inputRange: [0, 1],
      outputRange: [screenWidth, 0],
    });

    // ── Edge-swipe-to-dismiss ────────────────────────────────────────
    // A thin invisible strip pinned to the screen's left edge owns a
    // PanResponder that drags the detail pane back to the right. Only
    // arms when:
    //   - the detail pane is currently shown (activeId != null), AND
    //   - the gesture starts within EDGE_WIDTH of the left screen edge,
    //     AND
    //   - the first movement is horizontal-dominant + rightward.
    // Those gates keep the strip from eating bubble swipes, vertical
    // scrolls, or back-button taps in the ChatHeader.
    const EDGE_WIDTH = 24;
    const DISMISS_VX_THRESHOLD = 0.4;
    const activeIdRef = useRef(activeId);
    useEffect(() => {
      activeIdRef.current = activeId;
    }, [activeId]);
    const panResponder = useMemo(() => {
      // Commit-vs-snap threshold scales with the screen so the gesture
      // feels right on phone widths AND tablets.
      const dismissDxThreshold = screenWidth * 0.35;
      return PanResponder.create({
        // Never claim the touch on start — that would swallow taps on
        // the back button in the ChatHeader strip.
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_e, gs) => {
          if (!activeIdRef.current) return false;
          if (gs.x0 > EDGE_WIDTH) return false;
          return gs.dx > 6 && Math.abs(gs.dx) > Math.abs(gs.dy);
        },
        onMoveShouldSetPanResponderCapture: (_e, gs) => {
          if (!activeIdRef.current) return false;
          if (gs.x0 > EDGE_WIDTH) return false;
          return gs.dx > 6 && Math.abs(gs.dx) > Math.abs(gs.dy);
        },
        onPanResponderGrant: () => {
          draggingRef.current = true;
          slide.stopAnimation();
        },
        onPanResponderMove: (_e, gs) => {
          // Map finger displacement to slide: dx=0 → slide=1
          // (detail fully on); dx=screenWidth → slide=0 (off).
          const dx = Math.max(0, gs.dx);
          const progress = Math.min(1, dx / screenWidth);
          slide.setValue(1 - progress);
        },
        onPanResponderRelease: (_e, gs) => {
          draggingRef.current = false;
          const past = gs.dx > dismissDxThreshold || gs.vx > DISMISS_VX_THRESHOLD;
          if (past) {
            // Let the activeId-effect drive the close animation from
            // wherever the finger left the pane — Animated.timing
            // starts from the current value, so the motion is
            // continuous.
            setActiveId(null);
          } else {
            Animated.timing(slide, {
              toValue: 1,
              duration: 220,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          // Another responder took over (rare — scroll, dialog).
          // Snap back to "open" so the pane doesn't get stuck.
          draggingRef.current = false;
          Animated.timing(slide, {
            toValue: 1,
            duration: 220,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminationRequest: () => false,
      });
    }, [slide, screenWidth]);

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

    const renderRow = useCallback(
      (conv: Conversation, selected: boolean) => {
        if (renderConversationRow) {
          return <>{renderConversationRow(conv, meExternalId, selected)}</>;
        }
        // Live unread count from useConversations — updates immediately
        // when markConversationRead fires, instead of waiting for the
        // next list refetch. Falls back to the server snapshot on the
        // conversation row when the live map doesn't have an entry yet.
        const unread = unreadCounts?.[conv.id] ?? conv.unread_count ?? 0;
        return (
          <DefaultConversationRow
            conv={conv}
            selected={selected}
            meExternalId={meExternalId}
            unread={unread}
            {...(labelFor ? { labelFor } : {})}
            {...(avatarFor ? { avatarFor } : {})}
            onPress={() => setActiveId(conv.id)}
          />
        );
      },
      [renderConversationRow, meExternalId, labelFor, avatarFor, unreadCounts],
    );

    return (
      <View style={[styles.root, { backgroundColor: theme.colors.paper }]}>
        {/* LIST PANE */}
        <Animated.View
          style={[StyleSheet.absoluteFillObject, { transform: [{ translateX: listTransform }] }]}
          pointerEvents={activeId ? 'none' : 'auto'}
        >
          <View
            style={[
              styles.listHeader,
              {
                backgroundColor: theme.colors.surface,
                borderBottomColor: theme.colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.listTitle,
                { color: theme.colors.ink, fontFamily: theme.type.fontDisplay },
              ]}
            >
              {title}
            </Text>
            <View style={styles.headerActions}>
              {users ? (
                <>
                  <HeaderIconButton
                    icon="compose"
                    onPress={() => setUserPickerOpen(true)}
                    label="New chat"
                  />
                  <HeaderIconButton
                    icon="users"
                    onPress={() => setGroupPickerOpen(true)}
                    label="New group"
                  />
                </>
              ) : null}
              {renderRightAction?.()}
            </View>
          </View>

          <ConversationList
            conversations={conversations}
            renderItem={renderRow}
            {...(emptyState !== undefined ? { emptyState } : {})}
          />
        </Animated.View>

        {/* DETAIL PANE — our own ChatHeader (with onBack wired) above
            a ConversationView with header={false} so they don't stack.
            PanResponder lives on this wrapper (not a separate overlay
            strip) so taps fall straight through to the back button /
            attachment / send buttons — the strip approach would have
            stolen the leftmost slice of those tap targets. The gate in
            onMoveShouldSetPanResponderCapture restricts gestures to
            the left edge + horizontal-dominant + rightward, so vertical
            scrolling, swipe-to-reply on bubbles (which lives further
            inside), and button taps stay unaffected. */}
        <Animated.View
          style={[StyleSheet.absoluteFillObject, { transform: [{ translateX: detailTransform }] }]}
          pointerEvents={activeId ? 'auto' : 'none'}
          {...panResponder.panHandlers}
        >
          {activeId ? (
            <View style={{ flex: 1 }}>
              <ChatHeader
                conversationId={activeId}
                onBack={() => setActiveId(null)}
                {...(labelFor ? { labelFor } : {})}
                {...(avatarFor ? { avatarFor } : {})}
              />
              <ConversationView
                key={activeId}
                conversationId={activeId}
                header={false}
                // Caller override wins; else use safe-area-top + our
                // ChatHeader height as the iOS keyboardVerticalOffset.
                keyboardOffset={keyboardOffset || detailKeyboardOffset}
                onMarkedRead={(convId) => {
                  // Optimistic local clear so the badge disappears
                  // immediately — server-side cursor was advanced
                  // by ConversationView's markReadUpTo.
                  markConversationRead(convId);
                }}
                onSent={() => {
                  // useConversations is per-call-site state — only
                  // OUR refetch updates the list's preview / timestamps.
                  void refetchConversations();
                }}
                {...(labelFor ? { labelFor } : {})}
                {...(avatarFor ? { avatarFor } : {})}
              />
            </View>
          ) : null}
        </Animated.View>

        {/* Pickers */}
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
      </View>
    );
  },
);

function HeaderIconButton({
  icon,
  onPress,
  label,
}: {
  icon: 'compose' | 'users';
  onPress: () => void;
  label: string;
}) {
  const theme = usePoolseTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.iconBtn,
        {
          backgroundColor: pressed ? theme.colors.surface2 : 'transparent',
        },
      ]}
    >
      <PoolseIcon name={icon} size={20} color={theme.colors.ink} />
    </Pressable>
  );
}

function DefaultConversationRow({
  conv,
  selected,
  meExternalId,
  unread,
  labelFor,
  avatarFor,
  onPress,
}: {
  conv: Conversation;
  selected: boolean;
  meExternalId: string | null;
  unread: number;
  labelFor?: (externalId: string) => string;
  avatarFor?: (externalId: string) => string | null;
  onPress: () => void;
}) {
  const theme = usePoolseTheme();

  // For directs, derive display from the OTHER member's external_id
  // (added to Conversation.member_external_ids by the backend). For
  // groups, use the conversation's own name + a group avatar tile.
  const isDirect = conv.type === 'direct';
  const otherExtId =
    isDirect && meExternalId
      ? (conv.member_external_ids ?? []).find((x) => x !== meExternalId)
      : null;

  const title = isDirect
    ? otherExtId
      ? (labelFor?.(otherExtId) ?? otherExtId)
      : 'Direct chat'
    : (conv.name ?? 'Untitled group');

  const avatarUrl = isDirect && otherExtId ? (avatarFor?.(otherExtId) ?? null) : null;
  const avatarSeed = isDirect ? (otherExtId ?? conv.id) : conv.id;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.row,
        {
          backgroundColor: selected ? theme.colors.surface2 : 'transparent',
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={styles.rowAvatar} />
      ) : (
        <Avatar src={null} name={title} seed={avatarSeed} size="md" />
      )}
      <View style={styles.rowBody}>
        <Text
          style={[styles.rowTitle, { color: theme.colors.ink, fontFamily: theme.type.fontBody }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text style={[styles.rowSubtitle, { color: theme.colors.ink3 }]} numberOfLines={1}>
          {conv.last_message_preview ??
            (isDirect ? (otherExtId ?? '') : `${(conv.member_external_ids ?? []).length} members`)}
        </Text>
      </View>
      {unread > 0 ? (
        <View style={[styles.unreadPill, { backgroundColor: theme.colors.unreadPill }]}>
          <Text style={[styles.unreadText, { color: theme.colors.unreadPillText }]}>
            {unread > 99 ? '99+' : String(unread)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  listTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowSubtitle: {
    fontSize: 12,
  },
  unreadPill: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
