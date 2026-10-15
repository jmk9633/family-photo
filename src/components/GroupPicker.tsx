import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ko } from '@/copy/ko';
import type { Group } from '@/features/groups/api';

import { colors, size } from './tokens';

// 사진 탭 위의 '모든 가족 ▾': 모든 가족 또는 그룹 하나를 고른다.

type Props = {
  visible: boolean;
  groups: Group[];
  selected: string | null; // null = 모든 가족
  onSelect: (groupId: string | null) => void;
  onClose: () => void;
};

export function GroupPicker({ visible, groups, selected, onSelect, onClose }: Props) {
  const options: { id: string | null; label: string }[] = [
    { id: null, label: ko.feed.allGroups },
    ...groups.map((g) => ({ id: g.id, label: g.name })),
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={ko.common.cancel}>
        <SafeAreaView edges={['bottom']} style={styles.sheetWrap}>
          {/* 시트 안을 눌러도 닫히지 않게 */}
          <Pressable style={styles.sheet} onPress={() => {}} accessible={false}>
            <Text style={styles.title} accessibilityRole="header">
              {ko.feed.chooseGroup}
            </Text>
            <ScrollView style={styles.list}>
              {options.map((o) => {
                const active = o.id === selected;
                return (
                  <Pressable
                    key={o.id ?? 'all'}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={o.label}
                    onPress={() => onSelect(o.id)}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  >
                    <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                      {o.label}
                    </Text>
                    {active ? <Ionicons name="checkmark" size={24} color={colors.accent} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </SafeAreaView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheetWrap: { backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  sheet: { paddingTop: 20, paddingHorizontal: size.gutter, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 8 },
  list: { maxHeight: 420 },
  row: {
    minHeight: size.buttonHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  label: { fontSize: size.body, color: colors.text, flexShrink: 1 },
  labelActive: { fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
