import { useMemo, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { Avatar } from '../primitives/Avatar.js';
import { PoolseIcon } from '../primitives/PoolseIcon.js';
import { EDGE_TO_EDGE_MODAL } from './edgeToEdge.js';
import { useSafeInsets } from './safeArea.js';
import { useDismissableSheet } from './useDismissableSheet.js';
import { useKeyboardOpen } from './useKeyboardOpen.js';
import { usePoolseTheme } from '../theme/PoolseTheme.js';

export interface InboxUser {
  /** The user's external_id (the same id you mint JWTs with). */
  externalId: string;
  /** Display name shown in the picker row. */
  name: string;
  /** Optional avatar URL — falls back to initials if missing. */
  avatarUrl?: string | null;
  /** Optional secondary line (email, role, handle…). */
  subtitle?: string;
}

export interface UserPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  users: InboxUser[];
  /** External_ids to hide (usually the caller's own id). */
  excludeIds?: string[];
  /**
   * `single` → direct-chat mode; tap a row, fires onPickDirect, closes.
   * `group`  → multi-select with a group-name input + Create button.
   */
  mode: 'single' | 'group';
  onPickDirect?: (externalId: string) => void;
  onCreateGroup?: (name: string, memberExternalIds: string[]) => void;
  /** Optional header slot — title defaults to "New chat" / "New group". */
  title?: string;
  /** Search input shown when user count ≥ 8. Override to force on/off. */
  searchable?: boolean;
}

/**
 * Bottom-sheet picker for selecting one or many users from the
 * tenant's user directory. Used by `<PoolseInbox>` for the
 * built-in "New chat" / "New group" flows. Exported standalone so
 * devs can drive it from their own UI (e.g. a "Forward to…" sheet).
 */
export function UserPickerSheet({
  visible,
  onClose,
  users,
  excludeIds,
  mode,
  onPickDirect,
  onCreateGroup,
  title,
  searchable,
}: UserPickerSheetProps) {
  const theme = usePoolseTheme();
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const insets = useSafeInsets();
  const keyboardOpen = useKeyboardOpen();
  const { height: windowHeight } = useWindowDimensions();
  // Measured modal height — on some Android builds the window
  // dimensions exclude the nav bar while the translucent modal draws
  // under it, which would skew the keyboard offset by that much.
  const [rootHeight, setRootHeight] = useState(0);
  const screenHeight = rootHeight || windowHeight;
  // 85%, but never so tall the header slides under the status bar.
  const sheetHeight = Math.min(Math.round(screenHeight * 0.85), screenHeight - insets.top - 8);
  const { translateY, panHandlers } = useDismissableSheet({
    onClose: () => {
      // Reset selection state on dismiss so it doesn't survive
      // across opens.
      setQuery('');
      setSelectedIds([]);
      setGroupName('');
      onClose();
    },
    sheetHeight,
  });

  const excludeSet = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (excludeSet.has(u.externalId)) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        (u.subtitle ?? '').toLowerCase().includes(q) ||
        u.externalId.toLowerCase().includes(q)
      );
    });
  }, [users, query, excludeSet]);

  const showSearch = searchable ?? users.length >= 8;
  const isGroup = mode === 'group';
  const heading = title ?? (isGroup ? 'New group' : 'New chat');

  const reset = () => {
    setQuery('');
    setSelectedIds([]);
    setGroupName('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const toggle = (externalId: string) => {
    setSelectedIds((prev) =>
      prev.includes(externalId) ? prev.filter((id) => id !== externalId) : [...prev, externalId],
    );
  };

  const canCreate = isGroup && selectedIds.length > 0 && groupName.trim().length > 0;

  const handleCreate = () => {
    if (!canCreate) return;
    onCreateGroup?.(groupName.trim(), selectedIds);
    reset();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      // Edge-to-edge on Android like the host app, so the inset and
      // keyboard maths below hold on every device.
      {...EDGE_TO_EDGE_MODAL}
    >
      <View
        style={styles.modalRoot}
        onLayout={(e) => setRootHeight(Math.round(e.nativeEvent.layout.height))}
      >
        <Pressable style={styles.backdrop} onPress={handleClose} />

        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.paper,
              borderTopLeftRadius: theme.radii.xl,
              borderTopRightRadius: theme.radii.xl,
              height: sheetHeight,
              // Last row clears the nav bar — unless the keyboard is
              // covering it, where the inset would just be a gap.
              paddingBottom: keyboardOpen ? 0 : insets.bottom,
              paddingLeft: insets.left,
              paddingRight: insets.right,
              transform: [{ translateY }],
            },
            theme.shadows.lg,
          ]}
        >
          {/* The group-name / search inputs open the keyboard over a
              translucent, never-resized modal. A `padding` KAV (both
              platforms) shrinks the list to end above the keyboard;
              the offset is the gutter above the sheet because KAV
              measures its frame relative to the sheet, not the screen. */}
          <KeyboardAvoidingView
            style={styles.kav}
            behavior="padding"
            keyboardVerticalOffset={screenHeight - sheetHeight}
          >
            <View {...panHandlers} style={styles.dragHandle}>
              <View style={[styles.dragPill, { backgroundColor: theme.colors.ink3 }]} />
            </View>

            <View style={styles.header}>
              <Pressable
                onPress={handleClose}
                hitSlop={16}
                style={[styles.closeBtn, { backgroundColor: theme.colors.surface2 }]}
                accessibilityLabel="Close picker"
              >
                <PoolseIcon name="close" size={18} color={theme.colors.ink} />
              </Pressable>
              <Text
                style={[
                  styles.title,
                  { color: theme.colors.ink, fontFamily: theme.type.fontDisplay },
                ]}
                numberOfLines={1}
              >
                {heading}
              </Text>
              {isGroup ? (
                <Pressable
                  onPress={handleCreate}
                  disabled={!canCreate}
                  hitSlop={6}
                  style={[
                    styles.createBtn,
                    {
                      backgroundColor: canCreate ? theme.colors.brand : theme.colors.surface2,
                      opacity: canCreate ? 1 : 0.6,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: canCreate ? theme.colors.onBrand : theme.colors.ink3,
                      fontWeight: '700',
                      fontSize: 13,
                    }}
                  >
                    Create{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {isGroup ? (
              <TextInput
                placeholder="Group name"
                placeholderTextColor={theme.colors.ink3}
                value={groupName}
                onChangeText={setGroupName}
                style={[
                  styles.groupNameInput,
                  {
                    color: theme.colors.ink,
                    backgroundColor: theme.colors.surface2,
                    borderRadius: theme.radii.md,
                    fontFamily: theme.type.fontBody,
                    fontSize: theme.type.bodySize,
                  },
                ]}
              />
            ) : null}

            {showSearch ? (
              <TextInput
                placeholder="Search…"
                placeholderTextColor={theme.colors.ink3}
                value={query}
                onChangeText={setQuery}
                style={[
                  styles.searchInput,
                  {
                    color: theme.colors.ink,
                    backgroundColor: theme.colors.surface2,
                    borderRadius: theme.radii.md,
                    fontFamily: theme.type.fontBody,
                    fontSize: 14,
                  },
                ]}
              />
            ) : null}

            <FlatList
              data={filtered}
              keyExtractor={(u) => u.externalId}
              // First tap selects a row even with the keyboard up.
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={[styles.emptyText, { color: theme.colors.ink3 }]}>
                    {query ? 'No matches.' : 'No users to show.'}
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <UserRow
                  user={item}
                  selected={selectedIds.includes(item.externalId)}
                  isGroup={isGroup}
                  onPress={() => {
                    if (isGroup) toggle(item.externalId);
                    else {
                      onPickDirect?.(item.externalId);
                      reset();
                      onClose();
                    }
                  }}
                />
              )}
            />
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function UserRow({
  user,
  selected,
  isGroup,
  onPress,
}: {
  user: InboxUser;
  selected: boolean;
  isGroup: boolean;
  onPress: () => void;
}) {
  const theme = usePoolseTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.row,
        {
          backgroundColor: selected ? theme.colors.brandSoft : 'transparent',
        },
      ]}
    >
      {user.avatarUrl ? (
        <Image source={{ uri: user.avatarUrl }} style={styles.avatarImg} />
      ) : (
        <Avatar src={null} name={user.name} seed={user.externalId} size="md" />
      )}
      <View style={styles.body}>
        <Text
          style={[styles.name, { color: theme.colors.ink, fontFamily: theme.type.fontBody }]}
          numberOfLines={1}
        >
          {user.name}
        </Text>
        {user.subtitle ? (
          <Text style={[styles.subtitle, { color: theme.colors.ink3 }]} numberOfLines={1}>
            {user.subtitle}
          </Text>
        ) : null}
      </View>
      {isGroup ? (
        <View
          style={[
            styles.checkbox,
            {
              borderColor: selected ? theme.colors.brand : theme.colors.border,
              backgroundColor: selected ? theme.colors.brand : 'transparent',
            },
          ]}
        >
          {selected ? <PoolseIcon name="check" size={14} color={theme.colors.onBrand} /> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    overflow: 'hidden',
  },
  kav: {
    flex: 1,
  },
  dragHandle: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  dragPill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 10,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
  },
  createBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  groupNameInput: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontWeight: '600',
  },
  searchInput: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  avatarImg: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
  },
});
