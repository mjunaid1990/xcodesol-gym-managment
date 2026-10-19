import { Tabs } from 'expo-router'
import { Text } from 'react-native'
import { useSession } from '../../lib/session'
import { colors } from '../../lib/theme'

const icon = (glyph: string) => ({ color }: { color: string }) => (
  <Text style={{ color, fontSize: 18 }}>{glyph}</Text>
)

export default function TabsLayout() {
  const { user } = useSession()
  const isTrainer = user?.role === 'TRAINER' || user?.role === 'ADMIN' || user?.role === 'MANAGER'

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.ink900 },
        headerTintColor: colors.ink100,
        tabBarStyle: { backgroundColor: colors.ink900, borderTopColor: colors.ink700 },
        tabBarActiveTintColor: colors.lime,
        tabBarInactiveTintColor: colors.ink400,
        sceneStyle: { backgroundColor: colors.ink950 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'My gym', tabBarIcon: icon('🏠') }}
      />
      <Tabs.Screen name="classes" options={{ title: 'Classes', tabBarIcon: icon('📅') }} />
      <Tabs.Screen
        name="trainer"
        options={{
          title: 'Teaching',
          tabBarIcon: icon('🎯'),
          href: isTrainer ? '/trainer' : null,
        }}
      />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: icon('📈') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('👤') }} />
    </Tabs>
  )
}
