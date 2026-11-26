// Messaging plus for React Native — the same components and props as
// @poolse/react-ui's MessagingPlus and MediaMessages: PollCard (MS3),
// BlockRenderer (IN4), PinsList and ForwardSheet (MS13), FilesList
// (MS18), ForumPostList (MS7), CatchUpCard (MS20), TranslatedText (MS21),
// NoteCard (NT6), and voice / video messages (MS15, MS16).
//
// Media: this package has no audio or video dependency, so the players
// and the recorder take a small adapter the app builds on expo-audio /
// expo-video (or react-native-video): see `MediaPlayback` and
// `AudioRecorderAdapter`.

import {
  formatClock,
  initialBlockValues,
  isPollClosed,
  missingInputs,
  pollPercentages,
  type Attachment,
  type Block,
  type BlockActionRequest,
  type BlockValues,
  type CatchUp,
  type Message,
  type Poll,
  type Uuid,
} from '@poolse/sdk';
import { nextPlaybackRate, playbackRateLabel, waveformBars } from '@poolse/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PoolseIcon } from './primitives/PoolseIcon.js';
import { relativeTime } from './internal/time.js';
import { formatBytes, stripMarkdown } from './internal/plus.js';
import { useTheme } from './theme/PoolseTheme.js';

type Theme = ReturnType<typeof useTheme>;

// ── Poll (MS3) ───────────────────────────────────────────────────────────

export interface PollCardProps {
  question: string;
  poll: Poll;
  myOptionIds: readonly string[];
  onToggle?: (optionId: string) => void;
  onClose?: () => void;
  pending?: boolean;
  showResults?: boolean;
}

export function PollCard({
  question,
  poll,
  myOptionIds,
  onToggle,
  onClose,
  pending = false,
  showResults,
}: PollCardProps) {
  const theme = useTheme();
  const closed = isPollClosed(poll);
  const results = showResults ?? (myOptionIds.length > 0 || closed);
  const pct = pollPercentages(poll);
  const meta = [
    poll.multiple ? 'Choose any' : 'Choose one',
    poll.anonymous ? 'Anonymous' : null,
    `${poll.voters} ${poll.voters === 1 ? 'vote' : 'votes'}`,
    closed ? 'Closed' : null,
  ].filter(Boolean);
  return (
    <View style={s.card} accessibilityLabel={`Poll: ${question}`}>
      <Text style={[s.strong, { color: theme.colors.text }]}>{question}</Text>
      <Text style={[s.meta, { color: theme.colors.textSubtle }]}>{meta.join(' · ')}</Text>
      {poll.options.map((o) => {
        const mine = myOptionIds.includes(o.id);
        return (
          <Pressable
            key={o.id}
            onPress={() => onToggle?.(o.id)}
            disabled={closed || pending || !onToggle}
            accessibilityRole={poll.multiple ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: mine, disabled: closed }}
            style={[
              s.option,
              {
                borderColor: mine ? theme.colors.accent : theme.colors.border,
                borderRadius: theme.radii.md,
                backgroundColor: theme.colors.surface,
              },
            ]}
          >
            {results ? (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { width: `${pct[o.id] ?? 0}%`, backgroundColor: theme.colors.accentSoft },
                ]}
              />
            ) : null}
            <Text style={[s.mark, { color: theme.colors.accentStrong }]}>{mine ? '✓' : ''}</Text>
            <Text style={[s.flex, { color: theme.colors.text }]}>{o.text}</Text>
            {results ? (
              <Text style={[s.meta, { color: theme.colors.textMuted }]}>
                {pct[o.id] ?? 0}% · {o.votes}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
      {onClose && !closed ? (
        <Pressable onPress={onClose} disabled={pending} accessibilityRole="button">
          <Text style={[s.link, { color: theme.colors.accentStrong }]}>Close poll</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Blocks (IN4) ─────────────────────────────────────────────────────────

export interface BlockRendererProps {
  blocks: readonly Block[];
  onAction?: (req: BlockActionRequest) => Promise<unknown> | void;
  disabled?: boolean;
}

export function BlockRenderer({ blocks, onAction, disabled = false }: BlockRendererProps) {
  const theme = useTheme();
  const [values, setValues] = useState<BlockValues>(() => initialBlockValues(blocks));
  const [busy, setBusy] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [openSelect, setOpenSelect] = useState<string | null>(null);
  const off = disabled || !onAction || busy !== null;
  const set = (id: string, v: string | string[]) => setValues((p) => ({ ...p, [id]: v }));
  const run = async (req: BlockActionRequest) => {
    if (!onAction) return;
    setBusy(req.action_id);
    try {
      await onAction(req);
    } finally {
      setBusy(null);
    }
  };
  const btn = (label: string, onPress: () => void, style?: 'primary' | 'danger', key?: string) => (
    <Pressable
      key={key ?? label}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      style={[
        s.blockBtn,
        {
          borderRadius: theme.radii.sm,
          borderColor:
            style === 'danger'
              ? theme.colors.danger
              : style === 'primary'
                ? theme.colors.accent
                : theme.colors.border,
          backgroundColor: style === 'primary' ? theme.colors.accent : theme.colors.surface,
          opacity: off ? 0.6 : 1,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          s.btnText,
          {
            color:
              style === 'primary'
                ? theme.colors.accentText
                : style === 'danger'
                  ? theme.colors.danger
                  : theme.colors.text,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
  const choices = (
    id: string,
    options: readonly { text: string; value: string }[],
    placeholder: string,
    onChoose: (v: string) => void,
  ) => {
    const current = values[id];
    const label = options.find((o) => o.value === current)?.text ?? placeholder;
    return (
      <View key={id}>
        {btn(`${label} ▾`, () => setOpenSelect(openSelect === id ? null : id), undefined, id)}
        {openSelect === id
          ? options.map((o) => (
              <Pressable
                key={o.value}
                onPress={() => {
                  setOpenSelect(null);
                  onChoose(o.value);
                }}
                accessibilityRole="menuitem"
                style={s.choice}
              >
                <Text style={{ color: theme.colors.text }}>{o.text}</Text>
              </Pressable>
            ))
          : null}
      </View>
    );
  };
  return (
    <View style={s.blocks}>
      {blocks.map((b, i) => {
        const key = b.block_id ?? `${b.type}-${i}`;
        switch (b.type) {
          case 'section':
            return (
              <Text key={key} style={{ color: theme.colors.text }}>
                {stripMarkdown(b.text)}
              </Text>
            );
          case 'context':
            return (
              <Text key={key} style={[s.meta, { color: theme.colors.textSubtle }]}>
                {stripMarkdown(b.text)}
              </Text>
            );
          case 'divider':
            return <View key={key} style={[s.divider, { backgroundColor: theme.colors.border }]} />;
          case 'image':
            return (
              <Image
                key={key}
                source={{ uri: b.url }}
                accessibilityLabel={b.alt ?? ''}
                style={[s.blockImage, { borderRadius: theme.radii.md }]}
                resizeMode="cover"
              />
            );
          case 'actions':
            return (
              <View key={key} style={s.row}>
                {b.elements.map((e) =>
                  e.type === 'button'
                    ? btn(
                        e.text,
                        () => {
                          if (e.url) {
                            void Linking.openURL(e.url);
                            return;
                          }
                          if (e.submit) {
                            const miss = missingInputs(blocks, values).map((m) => m.action_id);
                            setMissing(miss);
                            if (miss.length === 0) void run({ action_id: e.action_id, values });
                          } else void run({ action_id: e.action_id });
                        },
                        e.style,
                        e.action_id,
                      )
                    : choices(e.action_id, e.options, e.placeholder ?? 'Choose…', (v) => {
                        set(e.action_id, v);
                        void run({ action_id: e.action_id, value: v });
                      }),
                )}
              </View>
            );
          case 'input': {
            const invalid = missing.includes(b.action_id);
            const v = values[b.action_id];
            return (
              <View key={key} style={s.input}>
                <Text style={[s.label, { color: theme.colors.text }]}>
                  {b.label}
                  {b.required ? ' *' : ''}
                </Text>
                {b.input === 'checkboxes' ? (
                  (b.options ?? []).map((o) => {
                    const list = Array.isArray(v) ? v : [];
                    const on = list.includes(o.value);
                    return (
                      <View key={o.value} style={s.row}>
                        <Switch
                          value={on}
                          disabled={disabled}
                          onValueChange={(next) =>
                            set(
                              b.action_id,
                              next ? [...list, o.value] : list.filter((x) => x !== o.value),
                            )
                          }
                          accessibilityLabel={o.text}
                        />
                        <Text style={{ color: theme.colors.text }}>{o.text}</Text>
                      </View>
                    );
                  })
                ) : b.input === 'select' ? (
                  choices(b.action_id, b.options ?? [], b.placeholder ?? 'Choose…', (x) =>
                    set(b.action_id, x),
                  )
                ) : (
                  <TextInput
                    value={(v as string) ?? ''}
                    onChangeText={(t) => set(b.action_id, t)}
                    placeholder={b.placeholder ?? (b.input === 'date' ? 'YYYY-MM-DD' : undefined)}
                    placeholderTextColor={theme.colors.textSubtle}
                    multiline={b.input === 'textarea'}
                    editable={!disabled}
                    accessibilityLabel={b.label}
                    style={[
                      s.textInput,
                      {
                        color: theme.colors.text,
                        borderColor: invalid ? theme.colors.danger : theme.colors.border,
                        borderRadius: theme.radii.sm,
                      },
                    ]}
                  />
                )}
                {invalid ? (
                  <Text style={[s.meta, { color: theme.colors.danger }]}>Required</Text>
                ) : null}
              </View>
            );
          }
          default:
            return null;
        }
      })}
    </View>
  );
}

// ── Pins and forward (MS13) ──────────────────────────────────────────────

export interface PinsListProps {
  pins: readonly Message[];
  labelFor?: (externalId: string) => string;
  onOpen?: (message: Message) => void;
  onUnpin?: (message: Message) => void;
  loading?: boolean;
}

export function PinsList({ pins, labelFor, onOpen, onUnpin, loading }: PinsListProps) {
  const theme = useTheme();
  if (pins.length === 0)
    return <Empty theme={theme} text={loading ? 'Loading pins…' : 'No pinned messages yet'} />;
  return (
    <View>
      {pins.map((m) => (
        <View key={m.id} style={[s.listRow, { borderBottomColor: theme.colors.border }]}>
          <Pressable style={s.flex} onPress={() => onOpen?.(m)} accessibilityRole="button">
            <Text numberOfLines={1} style={[s.strong, { color: theme.colors.text }]}>
              {m.sender_external_id ? (labelFor?.(m.sender_external_id) ?? 'Someone') : 'System'}
            </Text>
            <Text numberOfLines={2} style={{ color: theme.colors.textMuted }}>
              {m.deleted_at ? 'Message deleted' : (m.body ?? '')}
            </Text>
          </Pressable>
          {onUnpin ? (
            <Pressable onPress={() => onUnpin(m)} hitSlop={8} accessibilityLabel="Unpin">
              <PoolseIcon name="close" size={16} color={theme.colors.textMuted} label={null} />
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export interface ForwardTarget {
  id: Uuid;
  name: string;
}

export interface ForwardSheetProps {
  visible: boolean;
  targets: readonly ForwardTarget[];
  onForward: (conversationIds: Uuid[], comment: string) => Promise<unknown> | void;
  onClose: () => void;
  max?: number;
}

export function ForwardSheet({
  visible,
  targets,
  onForward,
  onClose,
  max = 10,
}: ForwardSheetProps) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Uuid[]>([]);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const q = query.trim().toLowerCase();
  const shown = targets.filter((t) => !q || t.name.toLowerCase().includes(q)).slice(0, 50);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[s.scrim, { backgroundColor: theme.colors.overlay }]}>
        <View
          style={[s.sheet, { backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg }]}
        >
          <Text style={[s.title, { color: theme.colors.text }]}>Forward message</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search channels and people"
            placeholderTextColor={theme.colors.textSubtle}
            accessibilityLabel="Search channels and people"
            style={[
              s.textInput,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                borderRadius: theme.radii.sm,
              },
            ]}
          />
          <ScrollView style={s.targets} keyboardShouldPersistTaps="always">
            {shown.map((t) => {
              const on = picked.includes(t.id);
              return (
                <Pressable
                  key={t.id}
                  onPress={() =>
                    setPicked((p) =>
                      on ? p.filter((x) => x !== t.id) : p.length < max ? [...p, t.id] : p,
                    )
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={s.targetRow}
                >
                  <Text style={[s.mark, { color: theme.colors.accentStrong }]}>
                    {on ? '✓' : ''}
                  </Text>
                  <Text numberOfLines={1} style={[s.flex, { color: theme.colors.text }]}>
                    {t.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Add a message (optional)"
            placeholderTextColor={theme.colors.textSubtle}
            accessibilityLabel="Add a message"
            multiline
            style={[
              s.textInput,
              {
                color: theme.colors.text,
                borderColor: theme.colors.border,
                borderRadius: theme.radii.sm,
              },
            ]}
          />
          <View style={s.actions}>
            <Pressable
              onPress={onClose}
              style={[s.pill, { backgroundColor: theme.colors.surfaceAlt }]}
            >
              <Text style={[s.btnText, { color: theme.colors.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={picked.length === 0 || sending}
              onPress={async () => {
                setSending(true);
                try {
                  await onForward(picked, comment.trim());
                  onClose();
                } finally {
                  setSending(false);
                }
              }}
              style={[
                s.pill,
                { backgroundColor: theme.colors.accent, opacity: picked.length === 0 ? 0.5 : 1 },
              ]}
            >
              <Text style={[s.btnText, { color: theme.colors.accentText }]}>
                {picked.length > 1 ? `Forward to ${picked.length}` : 'Forward'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Files (MS18) and forum (MS7) ─────────────────────────────────────────

export interface FilesListProps {
  files: readonly Attachment[];
  onOpen?: (file: Attachment) => void;
  thumbnailFor?: (file: Attachment) => string | null | undefined;
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
  const theme = useTheme();
  if (files.length === 0)
    return <Empty theme={theme} text={loading ? 'Loading files…' : 'No files yet'} />;
  return (
    <View>
      {files.map((f) => {
        const thumb = f.has_thumbnail ? thumbnailFor?.(f) : null;
        return (
          <View key={f.id} style={[s.listRow, { borderBottomColor: theme.colors.border }]}>
            <Pressable
              style={[s.row, s.flex]}
              onPress={() => onOpen?.(f)}
              accessibilityRole="button"
            >
              <View
                style={[
                  s.thumb,
                  { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.sm },
                ]}
              >
                {thumb ? (
                  <Image source={{ uri: thumb }} style={s.thumbImg} />
                ) : (
                  <Text>{fileGlyph(f)}</Text>
                )}
              </View>
              <View style={s.flex}>
                <Text numberOfLines={1} style={[s.strong, { color: theme.colors.text }]}>
                  {f.original_filename ?? 'Untitled file'}
                </Text>
                <Text numberOfLines={1} style={[s.meta, { color: theme.colors.textSubtle }]}>
                  {[
                    formatBytes(f.byte_size),
                    f.version && f.version > 1 ? `v${f.version}` : null,
                    relativeTime(f.inserted_at),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            </Pressable>
            {onVersions && f.version && f.version > 1 ? (
              <Pressable onPress={() => onVersions(f)} accessibilityRole="button">
                <Text style={[s.link, { color: theme.colors.accentStrong }]}>Versions</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {hasMore && onLoadMore ? (
        <Pressable onPress={onLoadMore} accessibilityRole="button" style={s.more}>
          <Text style={[s.link, { color: theme.colors.accentStrong }]}>Load more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface ForumPost {
  messageId: Uuid;
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
  const theme = useTheme();
  if (posts.length === 0)
    return <Empty theme={theme} text={loading ? 'Loading posts…' : 'No posts yet'} />;
  return (
    <View>
      {posts.map((p) => (
        <Pressable
          key={p.messageId}
          onPress={() => onOpen?.(p)}
          accessibilityRole="button"
          style={[s.listRow, s.column, { borderBottomColor: theme.colors.border }]}
        >
          <Text numberOfLines={2} style={[s.strong, { color: theme.colors.text }]}>
            {p.title}
          </Text>
          {p.tags && p.tags.length > 0 ? (
            <View style={s.row}>
              {p.tags.map((t) => (
                <Text
                  key={t.name}
                  style={[
                    s.tag,
                    { borderColor: t.color ?? theme.colors.border, color: theme.colors.textMuted },
                  ]}
                >
                  {t.name}
                </Text>
              ))}
            </View>
          ) : null}
          <Text numberOfLines={1} style={[s.meta, { color: theme.colors.textSubtle }]}>
            {p.authorName} · {p.replyCount} {p.replyCount === 1 ? 'reply' : 'replies'} ·{' '}
            {relativeTime(p.lastActivityAt)}
          </Text>
        </Pressable>
      ))}
      {hasMore && onLoadMore ? (
        <Pressable onPress={onLoadMore} accessibilityRole="button" style={s.more}>
          <Text style={[s.link, { color: theme.colors.accentStrong }]}>Load more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Catch-up (MS20), translation (MS21), note card (NT6) ─────────────────

export interface CatchUpCardProps {
  result: CatchUp | null;
  loading?: boolean;
  error?: unknown;
  onRun?: () => void;
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
  const theme = useTheme();
  return (
    <View
      style={[
        s.panel,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radii.lg,
        },
      ]}
    >
      <View style={s.row}>
        <Text style={[s.strong, s.flex, { color: theme.colors.text }]}>What did I miss</Text>
        {onDismiss ? (
          <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Dismiss">
            <PoolseIcon name="close" size={14} color={theme.colors.textMuted} label={null} />
          </Pressable>
        ) : null}
      </View>
      {loading ? (
        <Text style={{ color: theme.colors.textMuted }}>Reading the conversation…</Text>
      ) : error ? (
        <Text style={{ color: theme.colors.textMuted }}>Couldn't summarise right now.</Text>
      ) : result ? (
        result.summary ? (
          <>
            <Text style={{ color: theme.colors.text }}>{stripMarkdown(result.summary)}</Text>
            {result.highlights.map((h) => (
              <Pressable
                key={h.message_id}
                onPress={() => onOpenMessage?.(h.message_id, h.sequence)}
                accessibilityRole="link"
              >
                <Text style={[s.link, { color: theme.colors.link }]}>{h.why}</Text>
              </Pressable>
            ))}
            <Text style={[s.meta, { color: theme.colors.textSubtle }]}>
              {result.message_count} {result.message_count === 1 ? 'message' : 'messages'}
              {result.truncated ? ' (the newest 300)' : ''}
            </Text>
          </>
        ) : (
          <Text style={{ color: theme.colors.textMuted }}>Nothing new since your last visit.</Text>
        )
      ) : onRun ? (
        <Pressable onPress={onRun} accessibilityRole="button">
          <Text style={[s.link, { color: theme.colors.accentStrong }]}>
            Summarise what I missed
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export interface TranslatedTextProps {
  translation: string | null;
  languageName?: string;
  loading?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}

export function TranslatedText({
  translation,
  languageName,
  loading,
  onToggle,
  children,
}: TranslatedTextProps) {
  const theme = useTheme();
  return (
    <View>
      {translation !== null ? (
        <Text style={{ color: theme.colors.text }}>{translation}</Text>
      ) : (
        children
      )}
      {translation !== null || loading ? (
        <View style={s.row}>
          <Text style={[s.meta, { color: theme.colors.textSubtle }]}>
            {loading ? 'Translating…' : `Translated${languageName ? ` to ${languageName}` : ''}`}
          </Text>
          {onToggle && !loading ? (
            <Pressable onPress={onToggle} accessibilityRole="button">
              <Text style={[s.meta, s.strong, { color: theme.colors.accentStrong }]}>
                Show original
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export interface NoteCardProps {
  title: string | null;
  encrypted?: boolean;
  sharedByName?: string;
  updatedAt?: string;
  updated?: boolean;
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
  const theme = useTheme();
  const shown = unavailable
    ? "You don't have access to this note"
    : (title ?? (encrypted ? 'Encrypted note' : 'Note'));
  const meta = [
    sharedByName ? `Shared by ${sharedByName}` : null,
    updatedAt ? `Updated ${relativeTime(updatedAt)}` : null,
  ].filter(Boolean);
  return (
    <Pressable
      onPress={onOpen}
      disabled={unavailable || !onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${shown}${updated ? ', updated' : ''}`}
      style={[
        s.panel,
        s.row,
        {
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radii.md,
        },
      ]}
    >
      <View
        style={[
          s.thumb,
          { backgroundColor: theme.colors.accentSoft, borderRadius: theme.radii.sm },
        ]}
      >
        <PoolseIcon
          name={encrypted ? 'lock' : 'edit'}
          size={18}
          color={theme.colors.accentStrong}
          label={null}
        />
      </View>
      <View style={s.flex}>
        <View style={s.row}>
          <Text numberOfLines={1} style={[s.strong, s.shrink, { color: theme.colors.text }]}>
            {shown}
          </Text>
          {updated ? <View style={[s.dot, { backgroundColor: theme.colors.accent }]} /> : null}
        </View>
        {meta.length > 0 ? (
          <Text numberOfLines={1} style={[s.meta, { color: theme.colors.textSubtle }]}>
            {meta.join(' · ')}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// ── Voice and video messages (MS15, MS16) ────────────────────────────────

/**
 * What the players need from the app's media library (expo-audio's
 * `useAudioPlayer` + `useAudioPlayerStatus`, expo-video's player, …).
 */
export interface MediaPlayback {
  playing: boolean;
  positionMs: number;
  durationMs: number;
  play: () => void;
  pause: () => void;
  seek: (ms: number) => void;
  /** Set the speed (1, 1.5, 2). */
  setRate: (rate: number) => void;
}

function useRate(player: MediaPlayback) {
  const [rate, setRate] = useState(1);
  return {
    rate,
    cycle: () => {
      const next = nextPlaybackRate(rate);
      setRate(next);
      player.setRate(next);
    },
  };
}

function Transcript({ attachment, theme }: { attachment?: Attachment | null; theme: Theme }) {
  const [open, setOpen] = useState(false);
  if (!attachment) return null;
  if (attachment.transcript_status === 'pending')
    return <Text style={[s.meta, { color: theme.colors.textSubtle }]}>Transcribing…</Text>;
  if (!attachment.transcript) return null;
  return (
    <View>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={[s.meta, s.strong, { color: theme.colors.accentStrong }]}>
          {open ? 'Hide transcript' : 'Show transcript'}
        </Text>
      </Pressable>
      {open ? <Text style={{ color: theme.colors.textMuted }}>{attachment.transcript}</Text> : null}
    </View>
  );
}

export interface VoiceMessagePlayerProps {
  player: MediaPlayback;
  attachment?: Attachment | null;
  waveform?: readonly number[];
}

export function VoiceMessagePlayer({ player, attachment, waveform }: VoiceMessagePlayerProps) {
  const theme = useTheme();
  const { rate, cycle } = useRate(player);
  const total = player.durationMs || attachment?.duration_ms || 0;
  const bars = waveformBars(waveform ?? [], 28);
  const progress = total > 0 ? player.positionMs / total : 0;
  const [width, setWidth] = useState(0);
  return (
    <View style={s.media}>
      <View style={s.row}>
        <Pressable
          onPress={() => (player.playing ? player.pause() : player.play())}
          accessibilityRole="button"
          accessibilityLabel={player.playing ? 'Pause' : 'Play voice message'}
          style={[s.play, { backgroundColor: theme.colors.accent }]}
        >
          <Text style={{ color: theme.colors.accentText, fontSize: 12 }}>
            {player.playing ? '❚❚' : '▶'}
          </Text>
        </Pressable>
        <Pressable
          style={[s.wave, s.flex]}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          onPress={(e) => width > 0 && player.seek((e.nativeEvent.locationX / width) * total)}
          accessibilityRole="adjustable"
          accessibilityLabel="Position"
          accessibilityValue={{ text: formatClock(player.positionMs) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) =>
            player.seek(
              e.nativeEvent.actionName === 'increment'
                ? Math.min(total, player.positionMs + 5000)
                : Math.max(0, player.positionMs - 5000),
            )
          }
        >
          {bars.map((h, i) => (
            <View
              key={i}
              style={[
                s.bar,
                {
                  height: `${Math.round(h * 100)}%`,
                  backgroundColor:
                    i / bars.length < progress ? theme.colors.accent : theme.colors.textSubtle,
                },
              ]}
            />
          ))}
        </Pressable>
        <Text style={[s.time, { color: theme.colors.textMuted, fontFamily: theme.fonts.mono }]}>
          {formatClock(player.playing || player.positionMs > 0 ? player.positionMs : total)}
        </Text>
        <Pressable
          onPress={cycle}
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${playbackRateLabel(rate)}`}
          style={[s.rate, { borderColor: theme.colors.border }]}
        >
          <Text style={[s.meta, s.strong, { color: theme.colors.textMuted }]}>
            {playbackRateLabel(rate)}
          </Text>
        </Pressable>
      </View>
      <Transcript attachment={attachment ?? null} theme={theme} />
    </View>
  );
}

export interface VideoMessagePlayerProps {
  player: MediaPlayback;
  /** The video surface (expo-video's `<VideoView player={…}>`). */
  video: ReactNode;
  attachment?: Attachment | null;
}

export function VideoMessagePlayer({ player, video, attachment }: VideoMessagePlayerProps) {
  const theme = useTheme();
  const { rate, cycle } = useRate(player);
  return (
    <View style={s.media}>
      <View style={[s.video, { borderRadius: theme.radii.md }]}>{video}</View>
      <View style={s.row}>
        <Text
          style={[s.time, s.flex, { color: theme.colors.textMuted, fontFamily: theme.fonts.mono }]}
        >
          {formatClock(player.positionMs)} /{' '}
          {formatClock(player.durationMs || attachment?.duration_ms || 0)}
        </Text>
        <Pressable
          onPress={cycle}
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${playbackRateLabel(rate)}`}
          style={[s.rate, { borderColor: theme.colors.border }]}
        >
          <Text style={[s.meta, s.strong, { color: theme.colors.textMuted }]}>
            {playbackRateLabel(rate)}
          </Text>
        </Pressable>
      </View>
      {attachment?.summary ? (
        <Text style={{ color: theme.colors.textMuted }}>{attachment.summary}</Text>
      ) : null}
      <Transcript attachment={attachment ?? null} theme={theme} />
    </View>
  );
}

/** The app's recorder (expo-audio's `useAudioRecorder`, …). */
export interface AudioRecorderAdapter {
  /** Ask for the microphone if needed and start. */
  start: () => Promise<void>;
  /** Stop and return the file. */
  stop: () => Promise<{ uri: string; durationMs: number; mimeType: string }>;
  /** Stop and throw it away. */
  cancel: () => Promise<void>;
}

export interface VoiceRecorderProps {
  recorder: AudioRecorderAdapter;
  /** Upload with `purpose: 'voice'` and send. */
  onRecorded: (file: {
    uri: string;
    durationMs: number;
    mimeType: string;
  }) => void | Promise<unknown>;
  /** Stops by itself after this long. Default 15 minutes. */
  maxMs?: number;
  /** Shorter than this is dropped (a tap, not a recording). Default 700 ms. */
  minMs?: number;
  disabled?: boolean;
  onError?: (err: unknown) => void;
}

/** Hold to record, release to send; slide-free Cancel while recording. */
export function VoiceRecorder({
  recorder,
  onRecorded,
  maxMs = 15 * 60_000,
  minMs = 700,
  disabled,
  onError,
}: VoiceRecorderProps) {
  const theme = useTheme();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const active = useRef(false);
  // The finger is on the button. start() can wait on the permission
  // dialog; a release during that wait must not leave the mic running.
  const held = useRef(false);
  const starting = useRef(false);
  const mounted = useRef(true);

  const clear = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clear();
      // Leaving the screen mid-recording discards it.
      if (active.current) {
        active.current = false;
        void recorder.cancel().catch(() => {});
      }
    };
  }, [recorder]);

  const finish = async (send: boolean) => {
    held.current = false;
    if (!active.current) return;
    active.current = false;
    clear();
    setRecording(false);
    try {
      if (!send || Date.now() - startedAt.current < minMs) {
        await recorder.cancel();
        return;
      }
      await onRecorded(await recorder.stop());
    } catch (err) {
      onError?.(err);
    }
  };
  const begin = async () => {
    held.current = true;
    if (starting.current || active.current) return;
    starting.current = true;
    try {
      await recorder.start();
      if (!held.current || !mounted.current) {
        // Let go (or left) while the recorder was starting: nothing to send.
        await recorder.cancel().catch(() => {});
        return;
      }
      active.current = true;
      startedAt.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timer.current = setInterval(() => {
        const ms = Date.now() - startedAt.current;
        setElapsed(ms);
        if (ms >= maxMs) void finish(true);
      }, 200);
    } catch (err) {
      onError?.(err);
    } finally {
      starting.current = false;
    }
  };

  return (
    <View style={s.row}>
      {recording ? (
        <>
          <View style={[s.dot, { backgroundColor: theme.colors.danger }]} />
          <Text style={[s.time, { color: theme.colors.text, fontFamily: theme.fonts.mono }]}>
            {formatClock(elapsed)}
          </Text>
          <Pressable onPress={() => void finish(false)} accessibilityRole="button" hitSlop={8}>
            <Text style={[s.btnText, { color: theme.colors.textMuted }]}>Cancel</Text>
          </Pressable>
        </>
      ) : null}
      <Pressable
        onPressIn={() => void begin()}
        onPressOut={() => void finish(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Hold to record a voice message"
        style={[s.play, { backgroundColor: recording ? theme.colors.danger : 'transparent' }]}
        hitSlop={8}
      >
        <PoolseIcon
          name="mic"
          size={22}
          color={recording ? theme.colors.accentText : theme.colors.textMuted}
          label={null}
        />
      </Pressable>
    </View>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

function Empty({ theme, text }: { theme: Theme; text: string }) {
  return <Text style={[s.empty, { color: theme.colors.textSubtle }]}>{text}</Text>;
}

function fileGlyph(f: Attachment): string {
  return f.kind === 'image'
    ? '🖼'
    : f.kind === 'video'
      ? '🎬'
      : f.kind === 'audio'
        ? '🎙'
        : f.kind === 'document'
          ? '📄'
          : '📎';
}

const s = StyleSheet.create({
  card: { gap: 6, maxWidth: 420 },
  strong: { fontWeight: '600' },
  meta: { fontSize: 12 },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  column: { flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  mark: { width: 16, fontWeight: '700' },
  link: { fontWeight: '600', paddingVertical: 4 },
  blocks: { gap: 8, maxWidth: 420 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  blockBtn: { paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, maxWidth: '100%' },
  btnText: { fontSize: 14, fontWeight: '600' },
  choice: { paddingHorizontal: 12, paddingVertical: 8 },
  divider: { height: StyleSheet.hairlineWidth },
  blockImage: { width: '100%', aspectRatio: 16 / 9 },
  input: { gap: 4 },
  label: { fontSize: 13, fontWeight: '600' },
  textInput: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: { width: 40, height: 40 },
  tag: {
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderWidth: 1,
    borderRadius: 999,
  },
  more: { padding: 12, alignItems: 'center' },
  panel: { padding: 12, borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: { padding: 16, gap: 10, maxHeight: '85%' },
  title: { fontSize: 17, fontWeight: '700' },
  targets: { maxHeight: 280 },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  pill: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  media: { gap: 6, maxWidth: 420 },
  play: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 28, minWidth: 80 },
  bar: { flex: 1, minHeight: 3, borderRadius: 2 },
  time: { fontSize: 12, minWidth: 40 },
  rate: {
    minWidth: 40,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: 999,
    alignItems: 'center',
  },
  video: { width: '100%', aspectRatio: 16 / 9, overflow: 'hidden', backgroundColor: '#000' },
  empty: { padding: 16, textAlign: 'center' },
});
