import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Tabs } from 'expo-router';
import { Pressable, StyleSheet, View, type ColorValue } from 'react-native';

import { colors } from '@/components/tokens';
import { ko } from '@/copy/ko';

// 일반 모드 하단 탭 (와이어프레임 Home): 사진 · 앨범 · (보내기) · 가족 · 내 정보.
// 가운데 '보내기'는 탭이 아니라 보내기 화면을 여는 큰 버튼이다 (F-AXZNWA 트리거).

type IconName = keyof typeof Ionicons.glyphMap;

function tabIcon(outline: IconName, filled: IconName) {
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Ionicons name={focused ? filled : outline} size={24} color={color} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: styles.label,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: ko.tabs.photos, tabBarIcon: tabIcon('images-outline', 'images') }}
      />
      <Tabs.Screen
        name="album"
        options={{ title: ko.tabs.album, tabBarIcon: tabIcon('albums-outline', 'albums') }}
      />
      <Tabs.Screen
        name="compose"
        options={{
          title: ko.tabs.send,
          tabBarButton: () => (
            <View style={styles.sendSlot}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={ko.tabs.send}
                onPress={() => router.push('/send')}
                style={({ pressed }) => [styles.sendButton, pressed && styles.pressed]}
              >
                <Ionicons name="add" size={30} color="#FFFFFF" />
              </Pressable>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="family"
        options={{ title: ko.tabs.family, tabBarIcon: tabIcon('people-outline', 'people') }}
      />
      <Tabs.Screen
        name="me"
        options={{ title: ko.tabs.me, tabBarIcon: tabIcon('person-circle-outline', 'person-circle') }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '600' },
  sendSlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sendButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85 },
});
