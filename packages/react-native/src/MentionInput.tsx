import type { Membership, Uuid } from '@poolse/sdk';
import {
  mentionGroupMeta,
  rankMentionGroups,
  useMe,
  useMembers,
  usePoolse,
  useUser,
  type MentionGroup,
} from '@poolse/react';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  activeMentionQuery,
  filterMentionCandidates,
  insertMention,
  mentionedUserIds,
  type MentionQuery,
} from './internal/mentions.js';
import { AgentBadge } from './AgentBadge.js';
import { Avatar } from './primitives/Avatar.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import {
  MessageComposer,
  type ComposerSendOptions,
  type MessageComposerHandle,
  type MessageComposerProps,
} from './MessageComposer.js';
import { useTheme } from './theme/PoolseTheme.js';

export interface MentionInputProps extends Omit<MessageComposerProps, 'onSend'> {
  conversationId: Uuid;
  /** Same callback as MessageComposer.onSend, plus the mentioned user_ids. */
  onSend: (
    body: string,
    opts?: ComposerSendOptions & { mentions?: Uuid[] },
  ) => Promise<unknown> | void;
  /** Most suggestions shown at once. Defaults to 6. */
  maxSuggestions?: number;
  /**
   * User groups to offer after matching members (MS9): `@design`,
   * `@oncall`. Picking one inserts `@handle`; the Workspace expands it
   * when the message arrives, so nothing extra is sent.
   */
  groups?: readonly MentionGroup[];
}

interface Candidate {
  member: Membership;
  label: string;
  externalId: string;
}

/**
 * Composer with @-mentions: typing `@` (at the start or after a space)
 * shows matching conversation members above the input, filtered by
 * name or id as you type. Picking one inserts `@Name ` and the send
 * carries their user id in `mentions` — for as long as `@Name` is
 * still in the text.
 */
export const MentionInput = forwardRef<MessageComposerHandle, MentionInputProps>(
  function MentionInput(
    {
      conversationId,
      onSend,
      maxSuggestions = 6,
      labelFor,
      value: valueProp,
      onChangeText,
      onSelectionChange,
      groups,
      ...composerProps
    },
    ref,
  ) {
    const theme = useTheme();
    const chat = usePoolse();
    const { me } = useMe();
    const { members } = useMembers(conversationId);
    const composerRef = useRef<MessageComposerHandle>(null);
    useImperativeHandle(
      ref,
      (): MessageComposerHandle => ({
        addFiles: (inputs) => composerRef.current?.addFiles(inputs),
        focus: () => composerRef.current?.focus(),
        clear: () => composerRef.current?.clear(),
        getText: () => composerRef.current?.getText() ?? '',
        setText: (t) => composerRef.current?.setText(t),
        insertText: (t) => composerRef.current?.insertText(t),
        setSelection: (start, end) => composerRef.current?.setSelection(start, end),
      }),
      [],
    );
    const [innerText, setInnerText] = useState('');
    const text = valueProp ?? innerText;
    const [cursor, setCursor] = useState(0);
    const [dismissedAt, setDismissedAt] = useState<number | null>(null);
    const pickedRef = useRef<Array<{ userId: Uuid; label: string }>>([]);

    const setText = (next: string) => {
      if (valueProp === undefined) setInnerText(next);
      onChangeText?.(next);
    };

    const query: MentionQuery | null = useMemo(() => {
      const q = activeMentionQuery(text, cursor);
      return q && q.start !== dismissedAt ? q : null;
    }, [text, cursor, dismissedAt]);

    const candidates = useMemo<Candidate[]>(() => {
      if (!query) return [];
      const all = members
        .filter((m) => m.user_id !== me?.id)
        .map((m) => ({
          member: m,
          externalId: m.external_id,
          label:
            labelFor?.(m.external_id) ??
            chat.users.peek(m.external_id)?.displayName ??
            m.external_id,
        }));
      return filterMentionCandidates(all, query.query, maxSuggestions);
    }, [query, members, me?.id, labelFor, chat, maxSuggestions]);

    const groupMatches = useMemo(
      () =>
        query && groups
          ? rankMentionGroups(groups, query.query, Math.max(0, maxSuggestions - candidates.length))
          : [],
      [query, groups, maxSuggestions, candidates.length],
    );

    const pickGroup = (g: MentionGroup) => {
      if (!query) return;
      const next = insertMention(text, query.start, cursor, g.handle);
      setText(next.text);
      setCursor(next.cursor);
      setTimeout(() => composerRef.current?.setSelection(next.cursor, next.cursor), 0);
    };

    const pick = (c: Candidate) => {
      if (!query) return;
      const next = insertMention(text, query.start, cursor, c.label);
      pickedRef.current = [...pickedRef.current, { userId: c.member.user_id, label: c.label }];
      setText(next.text);
      setCursor(next.cursor);
      // After React applies the new text, put the cursor after the mention.
      setTimeout(() => composerRef.current?.setSelection(next.cursor, next.cursor), 0);
    };

    const handleSend: MessageComposerProps['onSend'] = async (body, opts) => {
      const mentions = mentionedUserIds(body, pickedRef.current);
      const result = await onSend(body, { ...opts, ...(mentions.length > 0 ? { mentions } : {}) });
      // Held back (beforeSend): the text and its mentions stay.
      if (result === false) return false;
      pickedRef.current = [];
      return undefined;
    };

    const suggestions =
      query && candidates.length + groupMatches.length > 0 ? (
        <View
          style={[
            styles.suggestions,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.md,
            },
            theme.shadows.md,
          ]}
          accessibilityRole="menu"
          accessibilityLabel="Mention suggestions"
        >
          <ScrollView keyboardShouldPersistTaps="always" style={styles.suggestionScroll}>
            {candidates.map((c) => (
              <MentionRow
                key={c.member.user_id}
                externalId={c.externalId}
                label={c.label}
                onPress={() => pick(c)}
              />
            ))}
            {groupMatches.map((g) => (
              <GroupRow key={`group:${g.handle}`} group={g} onPress={() => pickGroup(g)} />
            ))}
          </ScrollView>
          <Pressable
            onPress={() => setDismissedAt(query.start)}
            style={styles.dismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss suggestions"
            hitSlop={6}
          >
            <PoolseIcon name="close" size={14} color={theme.colors.textSubtle} label={null} />
          </Pressable>
        </View>
      ) : null;

    return (
      <MessageComposer
        ref={composerRef}
        {...composerProps}
        {...(labelFor ? { labelFor } : {})}
        value={text}
        onChangeText={(next) => {
          setText(next);
          // A fresh `@` re-opens suggestions after a dismiss.
          if (dismissedAt !== null && !next.includes('@', dismissedAt)) setDismissedAt(null);
        }}
        onSelectionChange={(sel) => {
          setCursor(sel.end);
          onSelectionChange?.(sel);
        }}
        onSend={handleSend}
        accessory={suggestions}
      />
    );
  },
);

function MentionRow({
  externalId,
  label,
  onPress,
}: {
  externalId: string;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const resolved = useUser(externalId);
  const name = resolved.profile?.displayName ?? label;
  const agent = !!resolved.agent;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent' },
      ]}
      accessibilityRole="menuitem"
      accessibilityLabel={`Mention ${name}${agent ? ' (agent)' : ''}`}
    >
      <Avatar
        src={resolved.profile?.avatarUrl ?? null}
        name={name}
        seed={externalId}
        size="sm"
        agent={agent}
      />
      <Text
        style={[styles.rowText, { color: theme.colors.text, fontFamily: theme.fonts.body }]}
        numberOfLines={1}
      >
        {name}
      </Text>
      {agent ? <AgentBadge size="xs" /> : null}
    </Pressable>
  );
}

function GroupRow({ group, onPress }: { group: MentionGroup; onPress: () => void }) {
  const theme = useTheme();
  const meta = mentionGroupMeta(group);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent' },
      ]}
      accessibilityRole="menuitem"
      accessibilityLabel={`Mention group ${group.name}`}
    >
      <View style={[styles.groupIcon, { backgroundColor: theme.colors.accentSoft }]}>
        <Text style={[styles.groupAt, { color: theme.colors.accentStrong }]}>@</Text>
      </View>
      <View style={styles.groupText}>
        <Text
          style={[styles.rowText, { color: theme.colors.text, fontFamily: theme.fonts.body }]}
          numberOfLines={1}
        >
          {group.name}
        </Text>
        <Text style={[styles.groupMeta, { color: theme.colors.textSubtle }]} numberOfLines={1}>
          @{group.handle}
          {meta ? ` · ${meta}` : ''}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  groupIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupAt: { fontSize: 14, fontWeight: '700' },
  groupText: { flex: 1, minWidth: 0 },
  groupMeta: { fontSize: 12, marginTop: 1 },
  suggestions: {
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
    overflow: 'hidden',
  },
  suggestionScroll: {
    maxHeight: 220,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  // The name alone, with the whole row's width: an id next to it only
  // pushed the name out.
  rowText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  dismiss: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
});
