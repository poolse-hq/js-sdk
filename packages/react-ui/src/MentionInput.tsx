// MentionInput — drop-in replacement for `MessageComposer` that
// pops a member dropdown when the user types `@`. Members match on
// their display name (`labelFor`, else the SDK's `userResolver`) or
// their external id; the viewer isn't offered. Selecting one inserts
// `@display-name` and records their `user_id` in the `mentions` sent
// with the message — dropped again if the `@name` is deleted first.

import type { Membership, Message, MessageCreateRequest, Uuid } from '@poolse/sdk';
import {
  agentFromWire,
  displayNameOf,
  mentionedUserIdsIn,
  useMembers,
  usePoolse,
  useUser,
  useUserLabel,
  mentionGroupMeta,
  rankMentionGroups,
  type FormatKind,
  type MentionGroup,
  type SlashCommand,
} from '@poolse/react';
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { AgentBadge } from './AgentBadge.js';
import { Avatar } from './Avatar.js';
import {
  ComposerEmojiButton,
  insertAtCaret,
  sendErrorText,
  useComposerAttachments,
} from './composerParts.js';
import {
  DlpWarningDialog,
  FormattingToolbar,
  useComposerExtras,
  useDlpGuard,
} from './composerExtras.js';
import { composerAction, DEFAULT_KEYMAP, isImeComposing, type ComposerKeymap } from './keymap.js';
import { handleListEnter } from './listAutocomplete.js';
import { PoolseIcon } from './PoolseIcon.js';
import { UploadQueueStrip } from './UploadQueueStrip.js';
import { useAutogrow } from './useAutogrow.js';
import type { MessageComposerHandle } from './MessageComposer.js';

export interface MentionInputProps {
  conversationId: Uuid;
  /**
   * Called when the user submits a message. Receives the full
   * `MessageCreateRequest` shape (so `mentions` is wired correctly),
   * not just `body`. Typically:
   *   `onSend={(req) => send(req)}`  // from useMessages
   * Resolve to `false` to keep the draft in the composer.
   */
  onSend: (req: MessageCreateRequest) => Promise<unknown> | void;
  onTyping?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Resolve a member's `external_id` to a display name for the @
   * dropdown. Then the SDK's `userResolver`, then "Unknown user"
   * (never the id itself).
   */
  labelFor?: (externalId: string) => string;
  /**
   * Caller-owned "I'm replying to this message" state. Mirrors
   * `<MessageComposer replyingTo>` — renders a quote chip above the
   * input and includes `quoted_message_id` on send.
   */
  replyingTo?: Message | null;
  /** User clicked the (x) on the reply chip. Caller clears state. */
  onCancelReply?: () => void;
  /**
   * Same as `<MessageComposer attachments>`: enables the paperclip
   * button + queue strip + ref-exposed `addFiles` for drag-drop.
   * Defaults to `true`.
   */
  attachments?: boolean;
  /** An emoji button that opens `<EmojiPicker>` and inserts at the caret. Default `true`. */
  emojiPicker?: boolean;
  /**
   * The text changed (typing, an emoji, a restored draft, the reset after
   * a send). Not called for the initial empty value.
   */
  onValueChange?: (value: string) => void;
  /** Largest attachment accepted, in bytes; bigger files show an error chip instead. */
  maxFileSize?: number;
  /**
   * Accepted attachment types — MIME types, wildcards (`'image/*'`) or
   * extensions (`'.pdf'`). Other files show an error chip instead.
   */
  acceptFileTypes?: string[];
  /**
   * Composer shortcuts (send, new line, edit last, cancel) — see
   * `ComposerKeymap`. Defaults: Enter / Cmd+Enter send, Shift+Enter new
   * line, ↑ in an empty composer edits your last message, Esc cancels
   * the reply.
   */
  keymap?: ComposerKeymap;
  /**
   * ↑ in an empty composer: edit your last message. Return `false`
   * when there's none to edit (the caret then moves as usual).
   */
  onEditLast?: () => boolean | void;
  /** Same as `<MessageComposer formattingToolbar>`. Default `false`. */
  formattingToolbar?: boolean | readonly FormatKind[];
  /** Same as `<MessageComposer commands>`: `/command` suggestions. */
  commands?: readonly SlashCommand[];
  /**
   * User groups to offer next to members (MS9): `@design`, `@oncall`.
   * Picking one inserts `@handle`; the Workspace expands it when the
   * message arrives, so nothing extra is sent. Listed after matching
   * members, names first.
   */
  groups?: readonly MentionGroup[];
}

type Suggestion = { kind: 'member'; member: Membership } | { kind: 'group'; group: MentionGroup };

/** Most suggestions shown at once. */
const MAX_SUGGESTIONS = 8;

interface MentionState {
  /** Position of the active `@` in the textarea. */
  start: number;
  /** Search query typed after `@`. */
  query: string;
}

export const MentionInput = forwardRef<MessageComposerHandle, MentionInputProps>(
  function MentionInput(
    {
      conversationId,
      onSend,
      onTyping,
      placeholder = 'Type a message…',
      disabled = false,
      labelFor,
      replyingTo,
      onCancelReply,
      attachments = true,
      emojiPicker = true,
      maxFileSize,
      acceptFileTypes,
      onValueChange,
      keymap = DEFAULT_KEYMAP.composer,
      onEditLast,
      formattingToolbar = false,
      commands,
      groups,
    },
    ref,
  ) {
    const chat = usePoolse();
    const { members } = useMembers(conversationId);
    const [value, setValue] = useState('');
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    // The files of a send held back by data-loss prevention.
    const heldRef = useRef<readonly { localId: string }[]>([]);
    const [mention, setMention] = useState<MentionState | null>(null);
    const [activeIdx, setActiveIdx] = useState(0);
    const menuId = useId();
    // Re-render when a member's profile resolves (names to match on).
    const [, bumpProfiles] = useReducer((n: number) => n + 1, 0);
    // Members picked from the menu → the name inserted for them. Sent
    // as `mentions` only while `@name` is still in the text.
    const selectedMentions = useRef<Map<Uuid, string>>(new Map());
    const taRef = useRef<HTMLTextAreaElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    useAutogrow(taRef, value);
    const extras = useComposerExtras({ value, setValue, taRef, formatting: true, commands });
    const dlp = useDlpGuard();

    // Same queue as MessageComposer: staged uploads plus files refused
    // before upload; ready chips are swept after a successful send.
    const uploads = useComposerAttachments(attachments, {
      ...(maxFileSize !== undefined ? { maxFileSize } : {}),
      ...(acceptFileTypes ? { acceptFileTypes } : {}),
    });
    const { addFiles, uploading } = uploads;
    const visibleUploads = uploads.items;
    const readyCount = uploads.ready.length;
    const valueRef = useRef(value);
    valueRef.current = value;
    // Report text changes (drafts), skipping the first, empty render.
    const onValueChangeRef = useRef(onValueChange);
    onValueChangeRef.current = onValueChange;
    const reportedRef = useRef(value);
    useEffect(() => {
      if (reportedRef.current === value) return;
      reportedRef.current = value;
      onValueChangeRef.current?.(value);
    }, [value]);
    useImperativeHandle(
      ref,
      () => ({
        addFiles,
        getText: () => valueRef.current,
        setText: (text: string) => setValue(text),
        insertText: (text: string) => setValue((v) => insertAtCaret(v, text, taRef)),
        clear: () => setValue(''),
        focus: () => taRef.current?.focus(),
      }),
      [addFiles],
    );

    const label = (id: string) =>
      displayNameOf(id, { labelFor, profileName: chat.users.peek(id)?.displayName });
    const meId = chat.me.peek()?.id ?? null;

    // Resolve members' names once the menu opens, so typing a display
    // name finds them even before their messages were rendered.
    const menuOpen = mention !== null;
    useEffect(() => {
      if (!menuOpen || labelFor) return;
      let live = true;
      for (const m of members) {
        if (chat.users.peek(m.external_id) !== undefined) continue;
        void chat.users
          .get(m.external_id)
          .then(() => {
            if (live) bumpProfiles();
          })
          .catch(() => undefined);
      }
      return () => {
        live = false;
      };
    }, [menuOpen, members, chat, labelFor]);

    // Candidates for the current query: name or external id contains
    // it, names that start with it first; never the viewer.
    const filtered: Suggestion[] = mention
      ? [
          ...rankMembers(
            members.filter((m) => m.user_id !== meId),
            mention.query.toLowerCase(),
            label,
          ).map((member): Suggestion => ({ kind: 'member', member })),
          ...rankMentionGroups(groups ?? [], mention.query).map(
            (group): Suggestion => ({ kind: 'group', group }),
          ),
        ].slice(0, MAX_SUGGESTIONS)
      : [];

    // Reset active selection whenever the candidate list changes.
    useEffect(() => {
      setActiveIdx(0);
    }, [filtered.length, mention?.query]);

    const submit = async () => {
      const trimmed = value.trim();
      const ready = uploads.ready;
      const hasReady = ready.length > 0;
      if ((!trimmed && !hasReady) || sending || uploading) return;
      heldRef.current = ready;
      setSendError(null);
      setSending(true);
      try {
        // Picked from the menu, or written out by name (a restored
        // draft keeps the text, not who was picked).
        const mentions = mentionedUserIdsIn(
          trimmed,
          [...selectedMentions.current].map(([userId, label]) => ({ userId, label })),
          members
            .filter((m) => m.user_id !== meId)
            .map((m) => ({
              userId: m.user_id,
              label: displayNameOf(m.external_id, {
                labelFor,
                profileName: chat.users.peek(m.external_id)?.displayName,
                fallback: '',
              }),
            })),
        );
        const req: MessageCreateRequest = {
          body: trimmed,
          ...(mentions.length > 0 ? { mentions } : {}),
          ...(replyingTo ? { quoted_message_id: replyingTo.id } : {}),
          ...(hasReady ? { attachment_ids: ready.map((it) => it.attachment!.id) } : {}),
        };
        let kept = false;
        const sent = await dlp.guard(trimmed, async (ack) => {
          if ((await onSend(ack ? { ...req, dlp_acknowledged: true } : req)) === false) kept = true;
        });
        // Held back (data-loss prevention, a cancelled beforeSend): the
        // text stays for "Edit".
        if (!sent || kept) return;
        setValue('');
        selectedMentions.current = new Map();
        for (const it of ready) uploads.remove(it.localId);
        uploads.clearRejected();
      } catch (err) {
        // Nothing went out: the text and files stay; say why.
        setSendError(sendErrorText(err));
      } finally {
        setSending(false);
      }
    };

    const insertSuggestion = (s: Suggestion) => {
      if (s.kind === 'member') insertMention(s.member);
      else insertGroup(s.group);
    };

    const insertGroup = (g: MentionGroup) => {
      if (!mention) return;
      const before = value.slice(0, mention.start);
      const after = value.slice(mention.start + 1 + mention.query.length);
      const inserted = `@${g.handle} `;
      setValue(`${before}${inserted}${after}`);
      setMention(null);
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (!ta) return;
        const pos = before.length + inserted.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      });
    };

    const insertMention = (m: Membership) => {
      if (!mention) return;
      // Display by external_id (what the dev wired through `labelFor` /
      // userResolver). The mention array shipped on the wire is still
      // poolse user_ids for backwards compatibility with the backend's
      // `messages.mentions` column — the consumer doesn't see those.
      const name = label(m.external_id);
      const before = value.slice(0, mention.start);
      const after = value.slice(mention.start + 1 + mention.query.length);
      const inserted = `@${name} `;
      const next = `${before}${inserted}${after}`;
      selectedMentions.current.set(m.user_id, name);
      setValue(next);
      setMention(null);
      // Move caret to right after the inserted mention.
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (!ta) return;
        const pos = before.length + inserted.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      });
    };

    const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      setValue(next);
      extras.track(e.target);
      onTyping?.();

      // Detect an active @mention: look back from the caret for an `@`
      // not preceded by a word character. If found, extract the query.
      const caret = e.target.selectionStart ?? next.length;
      const head = next.slice(0, caret);
      const at = head.lastIndexOf('@');
      if (at === -1) {
        setMention(null);
        return;
      }
      const charBefore = at === 0 ? ' ' : head.charAt(at - 1);
      const isAtBoundary = /\s/.test(charBefore);
      const query = head.slice(at + 1);
      // The query is the run of non-whitespace chars after `@`.
      if (isAtBoundary && !/\s/.test(query)) {
        setMention({ start: at, query });
      } else {
        setMention(null);
      }
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Mid-composition (CJK input): the keys belong to the IME.
      if (isImeComposing(e)) return;
      if (mention && filtered.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIdx((i) => (i + 1) % filtered.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          const pick = filtered[activeIdx];
          if (pick) {
            e.preventDefault();
            insertSuggestion(pick);
            return;
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMention(null);
          return;
        }
      }

      if (extras.onKeyDown(e)) return;
      const action = composerAction(e, keymap);
      if (action === 'editLast') {
        if (value === '' && onEditLast && onEditLast() !== false) e.preventDefault();
        return;
      }
      if (action === 'newline' && e.key === 'Enter' && !e.shiftKey) {
        const result = handleListEnter(value, e.currentTarget.selectionStart);
        if (result) {
          e.preventDefault();
          setValue(result.value);
          requestAnimationFrame(() => {
            taRef.current?.setSelectionRange(result.caret, result.caret);
          });
        }
        return;
      }
      if (action === 'send') {
        // Smart list continuation — same behavior as MessageComposer.
        // Only kicks in when the mention menu is closed (the menu's own
        // Enter handler is in the block above and returns early).
        const ta = e.currentTarget;
        const caret = ta.selectionStart;
        const result =
          e.key === 'Enter' && !e.metaKey && !e.ctrlKey ? handleListEnter(value, caret) : null;
        if (result) {
          e.preventDefault();
          setValue(result.value);
          requestAnimationFrame(() => {
            taRef.current?.setSelectionRange(result.caret, result.caret);
          });
          return;
        }
        e.preventDefault();
        void submit();
      }
      // Esc clears the reply chip when one is active (and the mention
      // menu is closed — that branch is handled above).
      if (action === 'cancel' && replyingTo && onCancelReply && !mention) {
        e.preventDefault();
        onCancelReply();
      }
    };

    const replyLabel = useUserLabel(replyingTo?.sender_external_id, labelFor);

    const canSend = !disabled && !sending && !uploading && (value.trim() !== '' || readyCount > 0);

    return (
      <form
        className="poolse-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        style={{ position: 'relative' }}
      >
        {formattingToolbar && (
          <FormattingToolbar
            onFormat={extras.format}
            disabled={disabled || sending}
            {...(Array.isArray(formattingToolbar) ? { actions: formattingToolbar } : {})}
          />
        )}
        {sendError && (
          <p className="poolse-composer__error" role="alert">
            {sendError}
          </p>
        )}
        {replyingTo && (
          <div className="poolse-composer__reply" role="status">
            <div className="poolse-composer__reply-body">
              <span className="poolse-composer__reply-label">Replying to {replyLabel}</span>
              <span className="poolse-composer__reply-preview">{replyingTo.body ?? ''}</span>
            </div>
            {onCancelReply && (
              <button
                type="button"
                className="poolse-composer__reply-cancel"
                onClick={onCancelReply}
                aria-label="Cancel reply"
                title="Cancel reply"
              >
                <PoolseIcon name="close" size={14} label={null} />
              </button>
            )}
          </div>
        )}
        {attachments && visibleUploads.length > 0 && (
          <UploadQueueStrip
            items={visibleUploads}
            onCancel={uploads.cancel}
            onDismiss={uploads.dismiss}
            previewFor={uploads.previewFor}
          />
        )}
        <div className="poolse-composer__row">
          {attachments && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                {...(uploads.accept ? { accept: uploads.accept } : {})}
                className="poolse-attach-input"
                aria-label="Attach files"
                tabIndex={-1}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) addFiles(files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="poolse-composer__attach"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || sending}
                aria-label="Attach files"
                title="Attach files"
              >
                <PoolseIcon name="attachment" size={20} label={null} />
              </button>
            </>
          )}
          <textarea
            ref={taRef}
            className="poolse-composer__input"
            rows={1}
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onPaste={uploads.onPaste}
            onSelect={(e) => extras.track(e.currentTarget)}
            placeholder={placeholder}
            disabled={disabled || sending}
            aria-label={placeholder}
            aria-autocomplete="list"
            {...(mention && filtered.length > 0
              ? {
                  'aria-controls': menuId,
                  'aria-activedescendant': `${menuId}-opt-${activeIdx}`,
                }
              : extras.textareaProps)}
          />
          {emojiPicker && (
            <ComposerEmojiButton
              disabled={disabled || sending}
              onPick={(emoji) => setValue((v) => insertAtCaret(v, emoji, taRef))}
            />
          )}
          <button
            type="submit"
            className="poolse-composer__send"
            disabled={!canSend}
            aria-label="Send message"
            title={uploading ? 'Waiting for uploads…' : 'Send message'}
          >
            <PoolseIcon name="send-fill" label={null} />
          </button>
        </div>

        {mention && filtered.length > 0 && (
          <div id={menuId} className="poolse-mention-menu" role="listbox" aria-label="Members">
            {filtered.map((s, i) => (
              <div
                key={s.kind === 'member' ? s.member.id : `group:${s.group.handle}`}
                id={`${menuId}-opt-${i}`}
                role="option"
                aria-selected={i === activeIdx}
                className={`poolse-mention-menu__item${i === activeIdx ? ' poolse-mention-menu__item--active' : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => {
                  // Use mousedown so the textarea doesn't lose focus
                  // before the insert lands.
                  e.preventDefault();
                  insertSuggestion(s);
                }}
              >
                {s.kind === 'member' ? (
                  <MentionOption member={s.member} name={label(s.member.external_id)} />
                ) : (
                  <GroupOption group={s.group} />
                )}
              </div>
            ))}
          </div>
        )}
        {extras.menu}
        {dlp.pending && (
          <DlpWarningDialog
            outcome={dlp.pending.outcome}
            onEdit={() => {
              dlp.dismiss();
              taRef.current?.focus();
            }}
            onSendAnyway={() => {
              const retry = dlp.pending!.retry;
              const held = heldRef.current;
              setSending(true);
              void retry()
                .then((sent) => {
                  if (!sent) return;
                  setValue('');
                  selectedMentions.current = new Map();
                  for (const it of held) uploads.remove(it.localId);
                  uploads.clearRejected();
                })
                .catch((err: unknown) => setSendError(sendErrorText(err)))
                .finally(() => setSending(false));
            }}
          />
        )}
      </form>
    );
  },
);

// One suggestion: avatar and display name.
function MentionOption({ member, name }: { member: Membership; name: string }) {
  const { profile, agent: known } = useUser(member.external_id);
  const agent = !!known || !!agentFromWire(member);
  return (
    <>
      <Avatar src={profile?.avatarUrl ?? null} name={name} size="xs" agent={agent} />
      <span className="poolse-mention-menu__name">{name}</span>
      {agent ? <AgentBadge size="xs" /> : null}
    </>
  );
}

function GroupOption({ group }: { group: MentionGroup }) {
  const meta = mentionGroupMeta(group);
  return (
    <>
      <span className="poolse-mention-menu__group-icon" aria-hidden="true">
        @
      </span>
      <span className="poolse-mention-menu__name">{group.name}</span>
      <span className="poolse-mention-menu__handle">@{group.handle}</span>
      {meta ? <span className="poolse-mention-menu__meta">{meta}</span> : null}
    </>
  );
}

function rankMembers(
  members: Membership[],
  query: string,
  label: (externalId: string) => string,
): Membership[] {
  const scored: { m: Membership; score: number; name: string }[] = [];
  for (const m of members) {
    const name = label(m.external_id).toLowerCase();
    const ext = m.external_id.toLowerCase();
    const score =
      query === ''
        ? 1
        : name.startsWith(query)
          ? 3
          : name.split(/\s+/).some((w) => w.startsWith(query))
            ? 2
            : name.includes(query) || ext.includes(query)
              ? 1
              : 0;
    if (score > 0) scored.push({ m, score, name });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.map((s) => s.m);
}
