import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';

import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

/**
 * The two halves of the app: the ayahs to live by, and the Arabic to read them
 * with. Each tab owns its own header; screens pushed on top (reader, settings)
 * live in the root Stack.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const t = useT();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '600' },
        sceneStyle: { backgroundColor: theme.background },
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('appTitle'),
          tabBarLabel: t('tabGuidance'),
          tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="arabic"
        options={{
          title: t('tabArabic'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="language-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
