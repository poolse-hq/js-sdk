// Messaging plus components (docs/MESSAGING_PLUS.md, PLATFORM_PLUS.md §1):
// poll card (MS3), block renderer (IN4), pins list (MS13), forward dialog
// (MS13), files list (MS18), forum post list (MS7), catch-up card (MS20),
// translated text (MS21) and the note card (NT6). Same props in
// @poolse/react-native. They are presentational: feed them the hooks'
// state (usePoll, usePins, useFiles, useCatchUp, useTranslation).

import {
  blockActionErrorMessage,
  forwardErrorMessage,
  initialBlockValues,
  isPollClosed,
  missingInputs,
  pollPercentages,
  safeImageUrl,
  safeLinkUrl,
  type Attachment,
  type Block,
  type BlockActionRequest,
  type BlockValues,
  type CatchUp,
  type Message,
  type Poll,
  type Uuid,
} from '@poolse/sdk';
import { useId, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PoolseIcon } from './PoolseIcon.js';
import { formatRelativeTime } from './relativeTime.js';

// ── Poll (MS3) ───────────────────────────────────────────────────────────

export interface PollCardProps {
  /** The question (the message's `body`). */
  question: string;
  poll: Poll;
  myOptionIds: readonly string[];
  /** Tap an option (`usePoll().toggle`). */
  onToggle?: (optionId: string) => void;
  /** Shows "Close poll" (its sender or an owner/admin). */
  onClose?: () => void;
  pending?: boolean;
  /** Show the results before you vote. Default: after voting, or once closed. */
  showResults?: boolean;
  className?: string;
}

export function PollCard({
  question,
  poll,
  myOptionIds,
  onToggle,
  onClose,
  pending = false,
  showResults,
  className,
}: PollCardProps) {
  const closed = isPollClosed(poll);
  const voted = myOptionIds.length > 0;
  const results = showResults ?? (voted || closed);
  const pct = pollPercentages(poll);
  const meta = [
    poll.multiple ? 'Choose any' : 'Choose one',
    poll.anonymous ? 'Anonymous' : null,
    `${poll.voters} ${poll.voters === 1 ? 'vote' : 'votes'}`,
    closed
      ? 'Closed'
      : poll.closes_at
        ? `Closes ${new Date(poll.closes_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
        : null,
  ].filter(Boolean);
  return (
    <div
      className={['poolse-poll', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={`Poll: ${question}`}
    >
      <div className="poolse-poll__question">{question}</div>
      <div className="poolse-poll__meta">{meta.join(' · ')}</div>
      <ul className="poolse-poll__options">
        {poll.options.map((o) => {
          const mine = myOptionIds.includes(o.id);
          return (
            <li key={o.id}>
              <button
                type="button"
                className={`poolse-poll__option${mine ? ' poolse-poll__option--mine' : ''}`}
                role={poll.multiple ? 'checkbox' : 'radio'}
                aria-checked={mine}
                disabled={closed || pending || !onToggle}
                onClick={() => onToggle?.(o.id)}
              >
                {results && (
                  <span
                    className="poolse-poll__bar"
                    style={{ width: `${pct[o.id] ?? 0}%` }}
                    aria-hidden="true"
                  />
                )}
                <span className="poolse-poll__mark" aria-hidden="true">
                  {mine ? '✓' : ''}
                </span>
                <span className="poolse-poll__text">{o.text}</span>
                {results && (
                  <span className="poolse-poll__count">
                    {pct[o.id] ?? 0}% · {o.votes}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {onClose && !closed && (
        <button type="button" className="poolse-poll__close" onClick={onClose} disabled={pending}>
          Close poll
        </button>
      )}
    </div>
  );
}

// ── Blocks (IN4) ─────────────────────────────────────────────────────────

export interface BlockRendererProps {
  blocks: readonly Block[];
  /** A button, a select or a form submit (`chat.messages.one(id).action(req)`). */
  onAction?: (req: BlockActionRequest) => Promise<unknown> | void;
  disabled?: boolean;
  className?: string;
}

/** Renders a `type: "blocks"` message: sections, context, dividers, images, buttons, menus and forms. */
export function BlockRenderer({
  blocks,
  onAction,
  disabled = false,
  className,
}: BlockRendererProps) {
  const [values, setValues] = useState<BlockValues>(() => initialBlockValues(blocks));
  const [busy, setBusy] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  const run = async (req: BlockActionRequest) => {
    if (!onAction) return;
    setBusy(req.action_id);
    setError(null);
    try {
      await onAction(req);
    } catch (err) {
      setError(blockActionErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const set = (id: string, v: string | string[]) => setValues((p) => ({ ...p, [id]: v }));
  const off = disabled || !onAction || busy !== null;

  return (
    <div className={['poolse-blocks', className].filter(Boolean).join(' ')}>
      {blocks.map((b, i) => {
        const key = b.block_id ?? `${b.type}-${i}`;
        switch (b.type) {
          case 'section':
            return (
              <div key={key} className="poolse-blocks__section">
                <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                  {b.text}
                </ReactMarkdown>
              </div>
            );
          case 'context':
            return (
              <div key={key} className="poolse-blocks__context">
                <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                  {b.text}
                </ReactMarkdown>
              </div>
            );
          case 'divider':
            return <hr key={key} className="poolse-blocks__divider" />;
          case 'image': {
            const src = safeImageUrl(b.url);
            return src ? (
              <img
                key={key}
                className="poolse-blocks__image"
                src={src}
                alt={b.alt ?? ''}
                loading="lazy"
              />
            ) : null;
          }
          case 'actions':
            return (
              <div key={key} className="poolse-blocks__actions">
                {b.elements.map((e) =>
                  e.type === 'button' ? (
                    e.url ? (
                      // A link button with an unsafe URL (javascript:, data:…) renders as plain text.
                      safeLinkUrl(e.url) === null ? (
                        <span
                          key={e.action_id}
                          className="poolse-blocks__button"
                          aria-disabled="true"
                        >
                          {e.text}
                        </span>
                      ) : (
                        <a
                          key={e.action_id}
                          className="poolse-blocks__button"
                          href={safeLinkUrl(e.url) ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {e.text}
                        </a>
                      )
                    ) : (
                      <button
                        key={e.action_id}
                        type="button"
                        className={`poolse-blocks__button${e.style ? ` poolse-blocks__button--${e.style}` : ''}`}
                        disabled={off}
                        aria-busy={busy === e.action_id}
                        onClick={() => {
                          if (e.submit) {
                            const miss = missingInputs(blocks, values).map((m) => m.action_id);
                            setMissing(miss);
                            if (miss.length > 0) return;
                            void run({ action_id: e.action_id, values });
                          } else void run({ action_id: e.action_id });
                        }}
                      >
                        {e.text}
                      </button>
                    )
                  ) : (
                    <select
                      key={e.action_id}
                      className="poolse-blocks__select"
                      aria-label={e.placeholder ?? 'Choose'}
                      disabled={off}
                      value={(values[e.action_id] as string | undefined) ?? ''}
                      onChange={(ev) => {
                        set(e.action_id, ev.target.value);
                        if (ev.target.value)
                          void run({ action_id: e.action_id, value: ev.target.value });
                      }}
                    >
                      <option value="" disabled>
                        {e.placeholder ?? 'Choose…'}
                      </option>
                      {e.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.text}
                        </option>
                      ))}
                    </select>
                  ),
                )}
              </div>
            );
          case 'input': {
            const id = `${formId}-${b.action_id}`;
            const invalid = missing.includes(b.action_id);
            const v = values[b.action_id];
            return (
              <div
                key={key}
                className={`poolse-blocks__input${invalid ? ' poolse-blocks__input--invalid' : ''}`}
              >
                <label htmlFor={id} className="poolse-blocks__label">
                  {b.label}
                  {b.required ? <span aria-hidden="true"> *</span> : null}
                </label>
                {b.input === 'textarea' ? (
                  <textarea
                    id={id}
                    value={(v as string) ?? ''}
                    placeholder={b.placeholder}
                    aria-invalid={invalid}
                    disabled={disabled}
                    onChange={(e) => set(b.action_id, e.target.value)}
                  />
                ) : b.input === 'select' ? (
                  <select
                    id={id}
                    value={(v as string) ?? ''}
                    aria-invalid={invalid}
                    disabled={disabled}
                    onChange={(e) => set(b.action_id, e.target.value)}
                  >
                    <option value="">{b.placeholder ?? 'Choose…'}</option>
                    {(b.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.text}
                      </option>
                    ))}
                  </select>
                ) : b.input === 'checkboxes' ? (
                  <div id={id} role="group" aria-invalid={invalid}>
                    {(b.options ?? []).map((o) => {
                      const list = Array.isArray(v) ? v : [];
                      return (
                        <label key={o.value} className="poolse-blocks__check">
                          <input
                            type="checkbox"
                            checked={list.includes(o.value)}
                            disabled={disabled}
                            onChange={(e) =>
                              set(
                                b.action_id,
                                e.target.checked
                                  ? [...list, o.value]
                                  : list.filter((x) => x !== o.value),
                              )
                            }
                          />
                          <span>{o.text}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <input
                    id={id}
                    type={b.input === 'date' ? 'date' : 'text'}
                    value={(v as string) ?? ''}
                    placeholder={b.placeholder}
                    aria-invalid={invalid}
                    disabled={disabled}
                    onChange={(e) => set(b.action_id, e.target.value)}
                  />
                )}
                {invalid && <div className="poolse-blocks__error">Required</div>}
              </div>
            );
          }
          default:
            return null;
        }
      })}
      {error ? (
        <div className="poolse-blocks__error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

// ── Pins (MS13) ──────────────────────────────────────────────────────────

export interface PinsListProps {
  pins: readonly Message[];
  /** Display name for a sender (`external_id`). Never shows the id itself. */
  labelFor?: (externalId: string) => string;
  onOpen?: (message: Message) => void;
  onUnpin?: (message: Message) => void;
  loading?: boolean;
}

export function PinsList({ pins, labelFor, onOpen, onUnpin, loading = false }: PinsListProps) {
  if (loading && pins.length === 0) return <div className="poolse-plus-empty">Loading pins…</div>;
  if (pins.length === 0) return <div className="poolse-plus-empty">No pinned messages yet</div>;
  return (
    <ul className="poolse-pins" aria-label="Pinned messages">
      {pins.map((m) => (
        <li key={m.id} className="poolse-pins__item">
          <button type="button" className="poolse-pins__open" onClick={() => onOpen?.(m)}>
            <span className="poolse-pins__sender">{senderName(m, labelFor)}</span>
            <span className="poolse-pins__body">{previewOf(m)}</span>
            {m.pinned_at && (
              <span className="poolse-pins__time">{formatRelativeTime(m.pinned_at)}</span>
            )}
          </button>
          {onUnpin && (
            <button
              type="button"
              className="poolse-icon-btn"
              aria-label="Unpin"
              title="Unpin"
              onClick={() => onUnpin(m)}
            >
              <PoolseIcon name="close" size={14} label={null} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Forward (MS13) ───────────────────────────────────────────────────────

export interface ForwardTarget {
  id: Uuid;
  /** Channel or person name. */
  name: string;
}

export interface ForwardDialogProps {
  targets: readonly ForwardTarget[];
  /** `chat.messages.one(id).forward({conversation_ids, comment})`. */
  onForward: (conversationIds: Uuid[], comment: string) => Promise<unknown> | void;
  onClose: () => void;
  /** Most targets at once (the server takes 10). */
  max?: number;
}

export function ForwardDialog({ targets, onForward, onClose, max = 10 }: ForwardDialogProps) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Uuid[]>([]);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const q = query.trim().toLowerCase();
  const shown = targets.filter((t) => !q || t.name.toLowerCase().includes(q)).slice(0, 50);
  return (
    <div
      className="poolse-dlp-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="poolse-dlp-dialog__card poolse-forward">
        <h2 id={titleId} className="poolse-dlp-dialog__title">
          Forward message
        </h2>
        <input
          type="search"
          className="poolse-forward__search"
          placeholder="Search channels and people"
          aria-label="Search channels and people"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <ul className="poolse-forward__list">
          {shown.map((t) => {
            const on = picked.includes(t.id);
            return (
              <li key={t.id}>
                <label className="poolse-forward__item">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && picked.length >= max}
                    onChange={() =>
                      setPicked((p) => (on ? p.filter((x) => x !== t.id) : [...p, t.id]))
                    }
                  />
                  <span>{t.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <textarea
          className="poolse-forward__comment"
          placeholder="Add a message (optional)"
          aria-label="Add a message"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
        />
        {error ? (
          <p className="poolse-panel__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="poolse-dlp-dialog__actions">
          <button type="button" className="poolse-dlp-dialog__edit" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="poolse-dlp-dialog__send"
            disabled={picked.length === 0 || sending}
            onClick={async () => {
              setSending(true);
              setError(null);
              try {
                await onForward(picked, comment.trim());
                onClose();
              } catch (err) {
                // Keep the picks and the comment so a retry is one tap.
                setError(forwardErrorMessage(err));
              } finally {
                setSending(false);
              }
            }}
          >
            {picked.length > 1 ? `Forward to ${picked.length}` : 'Forward'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Forwarded from Ana" line for a forwarded copy. */
export function ForwardedLabel({
  message,
  labelFor,
}: {
  message: Pick<Message, 'forwarded_from'>;
  labelFor?: (externalId: string) => string;
}) {
  const f = message.forwarded_from;
  if (!f) return null;
  const who = f.sender_external_id ? (labelFor?.(f.sender_external_id) ?? null) : null;
  return <div className="poolse-forwarded">{who ? `Forwarded from ${who}` : 'Forwarded'}</div>;
}

// ── Files (MS18) ─────────────────────────────────────────────────────────

export interface FilesListProps {
  files: readonly Attachment[];
  /** Open (download or preview) a file. */
  onOpen?: (file: Attachment) => void;
  /** Its thumbnail URL when `has_thumbnail` (`chat.attachments.thumbnailUrl`, cached by the app). */
  thumbnailFor?: (file: Attachment) => string | null | undefined;
  /** Show its versions. */
  onVersions?: (file: Attachment) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loading?: boolean;
}

export function FilesList({
  files,
  onOpen,
  thumbnailFor,
  onVersions,
  hasMore,
  onLoadMore,
  loading,
}: FilesListProps) {
  if (loading && files.length === 0) return <div className="poolse-plus-empty">Loading files…</div>;
  if (files.length === 0) return <div className="poolse-plus-empty">No files yet</div>;
  return (
    <div className="poolse-files">
      <ul aria-label="Files">
        {files.map((f) => {
          const thumb = f.has_thumbnail ? thumbnailFor?.(f) : null;
          return (
            <li key={f.id} className="poolse-files__item">
              <button type="button" className="poolse-files__open" onClick={() => onOpen?.(f)}>
                <span className="poolse-files__thumb" aria-hidden="true">
                  {thumb ? <img src={thumb} alt="" loading="lazy" /> : fileGlyph(f)}
                </span>
                <span className="poolse-files__name">{f.original_filename ?? 'Untitled file'}</span>
                <span className="poolse-files__meta">
                  {[
                    formatBytes(f.byte_size),
                    f.version && f.version > 1 ? `v${f.version}` : null,
                    formatRelativeTime(f.inserted_at),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
              {onVersions && f.version && f.version > 1 && (
                <button
                  type="button"
                  className="poolse-files__versions"
                  onClick={() => onVersions(f)}
                >
                  Versions
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {hasMore && onLoadMore && (
        <button
          type="button"
          className="poolse-conversation__load-more"
          onClick={onLoadMore}
          disabled={loading}
        >
          Load more
        </button>
      )}
    </div>
  );
}

// ── Forum (MS7) ──────────────────────────────────────────────────────────

/** A post as the Workspace lists it (`GET /channels/:id/posts`), with names resolved by the app. */
export interface ForumPost {
  messageId: Uuid;
  /** The post's first line or snippet. */
  title: string;
  authorName: string;
  replyCount: number;
  lastActivityAt: string;
  tags?: readonly { name: string; color?: string | null }[];
}

export interface ForumPostListProps {
  posts: readonly ForumPost[];
  onOpen?: (post: ForumPost) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loading?: boolean;
}

export function ForumPostList({ posts, onOpen, hasMore, onLoadMore, loading }: ForumPostListProps) {
  if (loading && posts.length === 0) return <div className="poolse-plus-empty">Loading posts…</div>;
  if (posts.length === 0) return <div className="poolse-plus-empty">No posts yet</div>;
  return (
    <div className="poolse-forum">
      <ul aria-label="Posts">
        {posts.map((p) => (
          <li key={p.messageId}>
            <button type="button" className="poolse-forum__post" onClick={() => onOpen?.(p)}>
              <span className="poolse-forum__title">{p.title}</span>
              {p.tags && p.tags.length > 0 && (
                <span className="poolse-forum__tags">
                  {p.tags.map((t) => (
                    <span
                      key={t.name}
                      className="poolse-forum__tag"
                      style={t.color ? { borderColor: t.color } : undefined}
                    >
                      {t.name}
                    </span>
                  ))}
                </span>
              )}
              <span className="poolse-forum__meta">
                {p.authorName} · {p.replyCount} {p.replyCount === 1 ? 'reply' : 'replies'} ·{' '}
                {formatRelativeTime(p.lastActivityAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hasMore && onLoadMore && (
        <button
          type="button"
          className="poolse-conversation__load-more"
          onClick={onLoadMore}
          disabled={loading}
        >
          Load more
        </button>
      )}
    </div>
  );
}

// ── Catch-up (MS20) ──────────────────────────────────────────────────────

export interface CatchUpCardProps {
  result: CatchUp | null;
  loading?: boolean;
  /** Shown as a short line ("Couldn't summarise right now"). */
  error?: unknown;
  /** "What did I miss?" (`useCatchUp().run`). */
  onRun?: () => void;
  /** Jump to a highlighted message. */
  onOpenMessage?: (messageId: Uuid, sequence: number) => void;
  onDismiss?: () => void;
}

export function CatchUpCard({
  result,
  loading,
  error,
  onRun,
  onOpenMessage,
  onDismiss,
}: CatchUpCardProps) {
  return (
    <section className="poolse-catchup" aria-label="What did I miss" aria-busy={loading}>
      <header className="poolse-catchup__head">
        <span className="poolse-catchup__title">What did I miss</span>
        {onDismiss && (
          <button
            type="button"
            className="poolse-icon-btn"
            aria-label="Dismiss"
            onClick={onDismiss}
          >
            <PoolseIcon name="close" size={14} label={null} />
          </button>
        )}
      </header>
      {loading ? (
        <p className="poolse-catchup__text">Reading the conversation…</p>
      ) : error ? (
        <p className="poolse-catchup__text">Couldn't summarise right now.</p>
      ) : result ? (
        result.summary ? (
          <>
            <div className="poolse-catchup__text">
              <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                {result.summary}
              </ReactMarkdown>
            </div>
            {result.highlights.length > 0 && (
              <ul className="poolse-catchup__highlights">
                {result.highlights.map((h) => (
                  <li key={h.message_id}>
                    <button type="button" onClick={() => onOpenMessage?.(h.message_id, h.sequence)}>
                      {h.why}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="poolse-catchup__meta">
              {result.message_count} {result.message_count === 1 ? 'message' : 'messages'}
              {result.truncated ? ' (the newest 300)' : ''}
            </div>
          </>
        ) : (
          <p className="poolse-catchup__text">Nothing new since your last visit.</p>
        )
      ) : (
        onRun && (
          <button type="button" className="poolse-catchup__run" onClick={onRun}>
            Summarise what I missed
          </button>
        )
      )}
    </section>
  );
}

// ── Translate (MS21) ─────────────────────────────────────────────────────

export interface TranslatedTextProps {
  /** The translated text, or `null` to show the original. */
  translation: string | null;
  /** Language name to show, e.g. "German" (not the tag). */
  languageName?: string;
  loading?: boolean;
  /** "Show original" / "Translate". */
  onToggle?: () => void;
  /** The original body, rendered as the app renders bodies. */
  children: ReactNode;
}

export function TranslatedText({
  translation,
  languageName,
  loading,
  onToggle,
  children,
}: TranslatedTextProps) {
  return (
    <div className="poolse-translated">
      {translation !== null ? (
        <div className="poolse-translated__text" lang="">
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
            {translation}
          </ReactMarkdown>
        </div>
      ) : (
        children
      )}
      {(translation !== null || loading) && (
        <div className="poolse-translated__meta">
          {loading ? 'Translating…' : `Translated${languageName ? ` to ${languageName}` : ''}`}
          {onToggle && !loading && (
            <button type="button" className="poolse-translated__toggle" onClick={onToggle}>
              Show original
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Note card (NT6) ──────────────────────────────────────────────────────

/** The note id in a Workspace note link (`https://<address>/workspace/l/note/<id>`), or `null`. */
export function noteIdFromLink(url: string): string | null {
  const m = /\/workspace\/l\/note\/([A-Za-z0-9-]{8,64})(?:[/?#]|$)/.exec(url);
  return m ? m[1]! : null;
}

export interface NoteCardProps {
  /** Decrypted title; `null` while locked or for someone without access. */
  title: string | null;
  /** End-to-end encrypted: the title can only be read on your devices. */
  encrypted?: boolean;
  /** "Shared by Ana". */
  sharedByName?: string;
  updatedAt?: string;
  /** Has changed since you last opened it. */
  updated?: boolean;
  /** No access (revoked, expired, never shared). */
  unavailable?: boolean;
  onOpen?: () => void;
}

export function NoteCard({
  title,
  encrypted,
  sharedByName,
  updatedAt,
  updated,
  unavailable,
  onOpen,
}: NoteCardProps) {
  const shownTitle = unavailable
    ? "You don't have access to this note"
    : (title ?? (encrypted ? 'Encrypted note' : 'Note'));
  const meta = [
    sharedByName ? `Shared by ${sharedByName}` : null,
    updatedAt ? `Updated ${formatRelativeTime(updatedAt)}` : null,
  ].filter(Boolean);
  return (
    <button
      type="button"
      className="poolse-notecard"
      onClick={onOpen}
      disabled={unavailable || !onOpen}
    >
      <span className="poolse-notecard__icon" aria-hidden="true">
        <PoolseIcon name={encrypted ? 'lock' : 'edit'} size={18} label={null} />
      </span>
      <span className="poolse-notecard__body">
        <span className="poolse-notecard__title">
          {shownTitle}
          {updated && (
            <span className="poolse-notecard__dot" aria-label="Updated since you last looked" />
          )}
        </span>
        {meta.length > 0 && <span className="poolse-notecard__meta">{meta.join(' · ')}</span>}
      </span>
    </button>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function senderName(m: Message, labelFor?: (externalId: string) => string): string {
  if (!m.sender_external_id) return 'System';
  return labelFor?.(m.sender_external_id) ?? 'Someone';
}

function previewOf(m: Message): string {
  if (m.deleted_at) return 'Message deleted';
  if (m.type === 'poll') return `📊 ${m.body ?? ''}`;
  if (m.body) return m.body.length > 140 ? `${m.body.slice(0, 140)}…` : m.body;
  const n = m.attachments?.length ?? 0;
  return n > 0 ? `${n} ${n === 1 ? 'file' : 'files'}` : '';
}

function fileGlyph(f: Attachment): string {
  switch (f.kind) {
    case 'image':
      return '🖼';
    case 'video':
      return '🎬';
    case 'audio':
      return '🎙';
    case 'document':
      return '📄';
    default:
      return '📎';
  }
}

/** `512 B`, `48 KB`, `3.2 MB`. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
