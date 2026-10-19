import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { SessionProvider, useSession } from '../lib/session'
import { colors } from '../lib/theme'

function RouteGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession()
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    const inAuthGroup = segments[0] === '(auth)'
    if (!user && !inAuthGroup) router.replace('/login')
    if (user && inAuthGroup) router.replace('/')
  }, [user, loading, segments, router])

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink950 }}>
        <ActivityIndicator color={colors.lime} />
      </View>
    )
  }

  return <>{children}</>
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <RouteGate>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.ink900 },
            headerTintColor: colors.ink100,
            contentStyle: { backgroundColor: colors.ink950 },
            headerTitleStyle: { fontWeight: '600' },
          }}
        >
          <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </RouteGate>
    </SessionProvider>
  )
}
