import type { Membership, Uuid } from '@poolse/sdk';
import { useMe, useMembers, usePoolse, useUser } from '@poolse/react';
import { useMemo, useRef, useState } from 'react';
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
  type MessageComposerHandle,
  type MessageComposerProps,
} from './MessageComposer.js';
import { useTheme } from './theme/PoolseTheme.js';

export interface MentionInputProps extends Omit<MessageComposerProps, 'onSend'> {
  conversationId: Uuid;
  /** Same callback as MessageComposer.onSend, plus the mentioned user_ids. */
  onSend: (
    body: string,
    opts?: {
      quoted_message_id?: Uuid;
      attachment_ids?: Uuid[];
      mentions?: Uuid[];
    },
  ) => Promise<unknown> | void;
  /** Most suggestions shown at once. Defaults to 6. */
  maxSuggestions?: number;
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
export function MentionInput({
  conversationId,
  onSend,
  maxSuggestions = 6,
  labelFor,
  value: valueProp,
  onChangeText,
  onSelectionChange,
  ...composerProps
}: MentionInputProps) {
  const theme = useTheme();
  const chat = usePoolse();
  const { me } = useMe();
  const { members } = useMembers(conversationId);
  const composerRef = useRef<MessageComposerHandle>(null);
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
          labelFor?.(m.external_id) ?? chat.users.peek(m.external_id)?.displayName ?? m.external_id,
      }));
    return filterMentionCandidates(all, query.query, maxSuggestions);
  }, [query, members, me?.id, labelFor, chat, maxSuggestions]);

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
    await onSend(body, { ...opts, ...(mentions.length > 0 ? { mentions } : {}) });
    pickedRef.current = [];
  };

  const suggestions =
    query && candidates.length > 0 ? (
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
}

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

const styles = StyleSheet.create({
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
