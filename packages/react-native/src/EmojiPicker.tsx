import { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  emojiCategories,
  getRecentEmojis,
  recordRecentEmoji,
  searchEmoji,
} from './internal/emoji.js';
import { EDGE_TO_EDGE_MODAL } from './internal/edgeToEdge.js';
import { useSafeInsets } from './internal/safeArea.js';
import { PoolseIcon } from './primitives/PoolseIcon.js';
import { useTheme } from './theme/PoolseTheme.js';

export interface EmojiPickerProps {
  visible: boolean;
  onClose: () => void;
  /** An emoji was tapped. The picker closes unless `keepOpen`. */
  onPick: (emoji: string) => void;
  /** Stay open after a pick (the composer's picker, to type several). */
  keepOpen?: boolean;
  /** Heading. Defaults to "Pick an emoji". */
  title?: string;
}

const CELL = 44;

/**
 * Bottom-sheet emoji picker with search, recently used and categories.
 * Built in and dependency-free: a compact set of common emoji, parsed
 * the first time a picker opens.
 */
export function EmojiPicker({
  visible,
  onClose,
  onPick,
  keepOpen = false,
  title = 'Pick an emoji',
}: EmojiPickerProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      {...EDGE_TO_EDGE_MODAL}
    >
      {visible ? (
        <PickerSheet onClose={onClose} onPick={onPick} keepOpen={keepOpen} title={title} />
      ) : null}
    </Modal>
  );
}

function PickerSheet({
  onClose,
  onPick,
  keepOpen,
  title,
}: Required<Omit<EmojiPickerProps, 'visible'>>) {
  const theme = useTheme();
  const insets = useSafeInsets();
  const { width, height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState(getRecentEmojis);
  const listRef = useRef<SectionList<string[], { id: string; title: string }>>(null);
  const columns = Math.max(6, Math.floor((width - insets.left - insets.right - 16) / CELL));

  const categories = useMemo(() => emojiCategories(), []);
  const sections = useMemo(() => {
    const out: Array<{ id: string; title: string; data: string[][] }> = [];
    if (recent.length > 0)
      out.push({ id: 'recent', title: 'Recent', data: chunk(recent, columns) });
    for (const c of categories) {
      out.push({
        id: c.id,
        title: c.title,
        data: chunk(
          c.emojis.map((e) => e.emoji),
          columns,
        ),
      });
    }
    return out;
  }, [categories, recent, columns]);
  const results = useMemo(() => searchEmoji(query, columns * 6), [query, columns]);

  const pick = (emoji: string) => {
    recordRecentEmoji(emoji);
    setRecent(getRecentEmojis());
    onPick(emoji);
    if (!keepOpen) onClose();
  };

  const cell = (emoji: string) => (
    <Pressable
      key={emoji}
      onPress={() => pick(emoji)}
      style={({ pressed }) => [
        styles.cell,
        {
          borderRadius: theme.radii.sm,
          backgroundColor: pressed ? theme.colors.surfaceAlt : undefined,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={emoji}
    >
      <Text style={styles.emoji}>{emoji}</Text>
    </Pressable>
  );

  return (
    <KeyboardAvoidingView style={styles.kav} behavior="padding">
      <Pressable
        style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
        onPress={onClose}
        accessibilityLabel="Close emoji picker"
      />
      <View
        style={[
          styles.sheet,
          {
            height: Math.round(height * 0.55),
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radii.lg,
            borderTopRightRadius: theme.radii.lg,
            paddingBottom: insets.bottom,
            paddingLeft: insets.left + 8,
            paddingRight: insets.right + 8,
          },
          theme.shadows.lg,
        ]}
      >
        <View style={styles.headRow}>
          <Text
            style={[styles.title, { color: theme.colors.text, fontFamily: theme.fonts.display }]}
            accessibilityRole="header"
          >
            {title}
          </Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
            <PoolseIcon name="close" size={18} color={theme.colors.textMuted} label={null} />
          </Pressable>
        </View>
        <View
          style={[
            styles.search,
            { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.md },
          ]}
        >
          <PoolseIcon name="search" size={16} color={theme.colors.textSubtle} label={null} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search emoji"
            placeholderTextColor={theme.colors.textSubtle}
            autoCorrect={false}
            autoCapitalize="none"
            style={[styles.searchInput, { color: theme.colors.text, fontFamily: theme.fonts.body }]}
            accessibilityLabel="Search emoji"
          />
        </View>

        {query.trim() ? (
          results.length > 0 ? (
            <View style={styles.results}>{results.map((r) => cell(r.emoji))}</View>
          ) : (
            <Text style={[styles.empty, { color: theme.colors.textMuted }]}>No emoji found.</Text>
          )
        ) : (
          <>
            <View style={[styles.tabs, { borderBottomColor: theme.colors.border }]}>
              {sections.map((s, i) => (
                <Pressable
                  key={s.id}
                  hitSlop={4}
                  style={styles.tab}
                  onPress={() =>
                    listRef.current?.scrollToLocation({
                      sectionIndex: i,
                      itemIndex: 0,
                      viewOffset: 28,
                      animated: true,
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={s.title}
                >
                  <Text style={styles.tabEmoji}>{s.id === 'recent' ? '🕘' : s.data[0]?.[0]}</Text>
                </Pressable>
              ))}
            </View>
            <SectionList
              ref={listRef}
              sections={sections}
              keyExtractor={(row, i) => `${row[0] ?? ''}-${i}`}
              keyboardShouldPersistTaps="handled"
              stickySectionHeadersEnabled={false}
              initialNumToRender={8}
              onScrollToIndexFailed={() => undefined}
              renderSectionHeader={({ section }) => (
                <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                  {section.title}
                </Text>
              )}
              renderItem={({ item }) => <View style={styles.gridRow}>{item.map(cell)}</View>}
            />
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const styles = StyleSheet.create({
  kav: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    paddingTop: 12,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    marginHorizontal: 4,
    marginBottom: 6,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 8,
    fontSize: 15,
  },
  tabs: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    padding: 4,
  },
  tabEmoji: {
    fontSize: 18,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 4,
  },
  gridRow: {
    flexDirection: 'row',
  },
  results: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: 4,
  },
  cell: {
    width: CELL,
    height: CELL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 26,
    lineHeight: 32,
  },
  empty: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
