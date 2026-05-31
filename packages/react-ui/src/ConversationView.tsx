import type { Message } from '@poolse/sdk';
import { useMe, useMessages, useRealtimeStatus, useTyping } from '@poolse/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { usePoolseFonts } from './fonts.js';
import { MessageBubble } from './MessageBubble.js';
import { MessageComposer } from './MessageComposer.js';
import { TypingIndicator } from './TypingIndicator.js';

export interface ConversationViewProps {
  /** Which conversation to mount. Re-mounting with a different id swaps cleanly. */
  conversationId: string;

  /** Optional placeholder when there are no messages. */
  emptyState?: ReactNode;

  /**
   * Render-prop escape hatch for individual messages. Use this when
   * CSS-variable theming + `<MessageBubble>` isn't enough — e.g. you
   * want avatars, threading UI, reaction picker.
   */
  renderMessage?: (msg: Message, currentUserId: string | null) => ReactNode;

  /** Translate a typing user_id into a display name. */
  labelFor?: (userId: string) => string;

  /**
   * Auto-load the brand fonts (Bricolage Grotesque / Hanken Grotesk /
   * JetBrains Mono) from Google Fonts on mount. Defaults to `true`.
   * Set to `false` when the host app already loads them, when CSP
   * forbids dynamic <link> injection, or when you're self-hosting.
   */
  loadFonts?: boolean;
}

/**
 * Plug-and-play conversation surface. Composes `useMe`, `useMessages`,
 * `useTyping`, and `useRealtimeStatus` from `@poolse/react` with the
 * default `<MessageBubble>` / `<MessageComposer>` / `<TypingIndicator>`
 * pieces from this package.
 *
 * Drop in once for instant chat; eject to individual pieces (or the
 * raw hooks) when you need more control.
 *
 * ```tsx
 * import '@poolse/react-ui/styles.css';
 * import { PoolseProvider } from '@poolse/react';
 * import { ConversationView } from '@poolse/react-ui';
 *
 * <PoolseProvider config={{apiUrl, getToken}}>
 *   <ConversationView conversationId={id} />
 * </PoolseProvider>
 * ```
 */
export function ConversationView({
  conversationId,
  emptyState,
  renderMessage,
  labelFor,
  loadFonts = true,
}: ConversationViewProps) {
  usePoolseFonts(loadFonts);
  const { me } = useMe();
  const { messages, loading, error, hasMore, loadMore, send } = useMessages(conversationId);
  const { typing, signalTyping } = useTyping(conversationId);
  const status = useRealtimeStatus();

  const listRef = useRef<HTMLDivElement | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  // Auto-scroll to bottom when a new message arrives at the tail.
  // We compare against the last seen id rather than length so loadMore
  // (which prepends older messages) doesn't trigger a scroll.
  useEffect(() => {
    const tail = messages[messages.length - 1];
    if (!tail) return;
    if (tail.id === lastMessageIdRef.current) return;
    lastMessageIdRef.current = tail.id;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const renderOne = renderMessage ?? defaultRenderMessage;

  return (
    <div className="poolse-conversation">
      {status !== 'connected' && status !== 'idle' && (
        <div className="poolse-conversation__status">
          {status === 'connecting' && 'Connecting…'}
          {status === 'reconnecting' && 'Reconnecting…'}
          {status === 'closed' && 'Disconnected'}
        </div>
      )}

      <div className="poolse-conversation__messages" ref={listRef}>
        {hasMore && !loading && (
          <button type="button" className="poolse-conversation__load-more" onClick={loadMore}>
            Load older messages
          </button>
        )}

        {loading && messages.length === 0 ? (
          <div className="poolse-conversation__empty">Loading…</div>
        ) : messages.length === 0 ? (
          <div className="poolse-conversation__empty">{emptyState ?? 'No messages yet.'}</div>
        ) : (
          messages.map((msg) => <div key={msg.id}>{renderOne(msg, me?.id ?? null)}</div>)
        )}

        {error && (
          <div className="poolse-conversation__empty">Failed to load: {error.message}</div>
        )}
      </div>

      <TypingIndicator typing={typing} {...(labelFor ? { labelFor } : {})} />

      <MessageComposer onSend={(body) => send({ body })} onTyping={signalTyping} />
    </div>
  );
}

function defaultRenderMessage(msg: Message, currentUserId: string | null) {
  return <MessageBubble message={msg} currentUserId={currentUserId} />;
}
