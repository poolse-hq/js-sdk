// Pieces the composer adds around its input: the Markdown formatting
// toolbar (MS4), `/command` suggestions (IN3) and the data-loss-
// prevention warning (AD6). Same behaviour as @poolse/react-ui; the text
// logic is @poolse/react's composer-tools.

import {
  FORMAT_ACTIONS,
  filterSlashCommands,
  slashQuery,
  type DlpOutcome,
  type FormatKind,
  type SlashCommand,
} from '@poolse/react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from './theme/PoolseTheme.js';

export interface FormattingToolbarProps {
  onFormat: (kind: FormatKind) => void;
  disabled?: boolean;
  /** Which buttons, in order. Defaults to all of `FORMAT_ACTIONS`. */
  actions?: readonly FormatKind[];
}

/** A horizontally scrolling row of formatting buttons. */
export function FormattingToolbar({
  onFormat,
  disabled = false,
  actions = FORMAT_ACTIONS.map((a) => a.kind),
}: FormattingToolbarProps) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      contentContainerStyle={styles.toolbar}
      accessibilityRole="toolbar"
      accessibilityLabel="Formatting"
    >
      {actions.map((kind) => {
        const a = FORMAT_ACTIONS.find((x) => x.kind === kind);
        if (!a) return null;
        return (
          <Pressable
            key={kind}
            onPress={() => onFormat(kind)}
            disabled={disabled}
            hitSlop={4}
            style={({ pressed }) => [
              styles.toolBtn,
              {
                borderRadius: theme.radii.sm,
                backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
                opacity: disabled ? 0.5 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={a.label}
          >
            <Text
              style={[
                styles.toolGlyph,
                {
                  color: theme.colors.textMuted,
                  fontFamily:
                    kind === 'code' || kind === 'codeBlock' ? theme.fonts.mono : theme.fonts.body,
                },
                kind === 'italic' ? styles.italic : null,
                kind === 'strike' ? styles.strike : null,
              ]}
            >
              {a.glyph}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** `/command` suggestions for the text and cursor, or `null` when none match. */
export function CommandSuggestions({
  commands,
  text,
  cursor,
  onPick,
}: {
  commands: readonly SlashCommand[];
  text: string;
  cursor: number;
  onPick: (command: SlashCommand) => void;
}) {
  const theme = useTheme();
  const q = slashQuery(text, cursor);
  const matches = q ? filterSlashCommands(commands, q.query, 6) : [];
  if (matches.length === 0) return null;
  return (
    <View
      style={[
        styles.menu,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.md,
        },
        theme.shadows.md,
      ]}
      accessibilityRole="menu"
      accessibilityLabel="Commands"
    >
      <ScrollView keyboardShouldPersistTaps="always" style={styles.menuScroll}>
        {matches.map((c) => (
          <Pressable
            key={c.name}
            onPress={() => onPick(c)}
            style={({ pressed }) => [
              styles.menuRow,
              { backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent' },
            ]}
            accessibilityRole="menuitem"
            accessibilityLabel={`/${c.name}${c.description ? `, ${c.description}` : ''}`}
          >
            <View style={styles.menuHead}>
              <Text
                style={[styles.cmdName, { color: theme.colors.text, fontFamily: theme.fonts.mono }]}
              >
                /{c.name}
              </Text>
              {c.usage ? (
                <Text
                  style={[styles.cmdMeta, { color: theme.colors.textSubtle }]}
                  numberOfLines={1}
                >
                  {c.usage}
                </Text>
              ) : null}
              {c.source ? (
                <Text
                  style={[styles.cmdSource, { color: theme.colors.textSubtle }]}
                  numberOfLines={1}
                >
                  {c.source}
                </Text>
              ) : null}
            </View>
            {c.description ? (
              <Text style={[styles.cmdDesc, { color: theme.colors.textMuted }]} numberOfLines={1}>
                {c.description}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export interface DlpWarningSheetProps {
  outcome: DlpOutcome;
  /** "Send anyway" (only offered for a warning, never for a block). */
  onSendAnyway?: () => void;
  /** "Edit message": back to the composer with the text kept. */
  onEdit: () => void;
}

/** The data-loss-prevention warning as a centred modal. */
export function DlpWarningSheet({ outcome, onSendAnyway, onEdit }: DlpWarningSheetProps) {
  const theme = useTheme();
  const blocked = outcome.action === 'block';
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onEdit}>
      <View style={[styles.scrim, { backgroundColor: theme.colors.overlay }]}>
        <View
          style={[
            styles.card,
            { backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg },
          ]}
          accessibilityRole="alert"
        >
          <Text style={[styles.title, { color: theme.colors.text, fontFamily: theme.fonts.body }]}>
            {blocked ? "This message can't be sent" : 'Check this message before sending'}
          </Text>
          <Text style={[styles.text, { color: theme.colors.textMuted }]}>
            {outcome.message ??
              (blocked
                ? 'It contains something your workspace does not allow in messages.'
                : 'It looks like it contains something sensitive.')}
          </Text>
          {outcome.matches.map((m, i) => (
            <View key={i} style={styles.match}>
              <Text style={[styles.rule, { color: theme.colors.warning }]}>{m.rule}</Text>
              {m.excerpt ? (
                <Text
                  style={[
                    styles.excerpt,
                    { color: theme.colors.text, fontFamily: theme.fonts.mono },
                  ]}
                >
                  {m.excerpt}
                </Text>
              ) : null}
            </View>
          ))}
          <View style={styles.actions}>
            <Pressable
              onPress={onEdit}
              style={[styles.btn, { backgroundColor: theme.colors.surfaceAlt }]}
              accessibilityRole="button"
            >
              <Text style={[styles.btnText, { color: theme.colors.text }]}>Edit message</Text>
            </Pressable>
            {!blocked && onSendAnyway ? (
              <Pressable
                onPress={onSendAnyway}
                style={[styles.btn, { backgroundColor: theme.colors.accent }]}
                accessibilityRole="button"
              >
                <Text style={[styles.btnText, { color: theme.colors.accentText }]}>
                  Send anyway
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  toolbar: { gap: 2, paddingBottom: 6 },
  toolBtn: {
    minWidth: 34,
    height: 32,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolGlyph: { fontSize: 14, fontWeight: '600' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  menu: { borderWidth: StyleSheet.hairlineWidth, marginBottom: 8, overflow: 'hidden' },
  menuScroll: { maxHeight: 220 },
  menuRow: { paddingHorizontal: 12, paddingVertical: 8 },
  menuHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  cmdName: { fontSize: 14, fontWeight: '600' },
  cmdMeta: { fontSize: 12, flexShrink: 1 },
  cmdSource: { fontSize: 12, marginLeft: 'auto', flexShrink: 1, maxWidth: '45%' },
  cmdDesc: { fontSize: 12, marginTop: 2 },
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 400, padding: 18 },
  title: { fontSize: 16, fontWeight: '700' },
  text: { fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 12 },
  match: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  rule: { fontSize: 13, fontWeight: '600' },
  excerpt: { fontSize: 13 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  btn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  btnText: { fontSize: 14, fontWeight: '600' },
});
