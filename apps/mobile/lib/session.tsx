import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { apiClient, clearTokens, getAccessToken, saveTokens, type SessionUser } from './api'

interface SessionState {
  user: SessionUser | null
  loading: boolean
  signIn: (identifier: string, password: string) => Promise<void>
  signUp: (input: {
    email: string
    password: string
    firstName: string
    lastName: string
    phone?: string
    acceptWaiver: boolean
  }) => Promise<void>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

/**
 * Registers this device for push. Failures are ignored on purpose: notifications are a
 * convenience, never a reason the app cannot be used.
 */
async function registerForPush(): Promise<void> {
  try {
    const settings = await Notifications.getPermissionsAsync()
    let status = settings.status
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync()
      status = requested.status
    }
    if (status !== 'granted') return

    const token = await Notifications.getDevicePushTokenAsync()
    if (token?.data) {
      await apiClient.registerDevice(String(token.data), Platform.OS)
    }
  } catch {
    // Simulator or Expo Go: silently continue.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    const token = await getAccessToken()
    if (!token) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const payload = await apiClient.me()
      setUser(payload.user)
      await registerForPush()
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshUser()
  }, [refreshUser])

  const signIn = useCallback(async (identifier: string, password: string) => {
    const payload = await apiClient.login(identifier, password)
    await saveTokens(payload.accessToken, payload.refreshToken)
    setUser(payload.user)
    await registerForPush()
  }, [])

  const signUp = useCallback<SessionState['signUp']>(async (input) => {
    const payload = await apiClient.register(input)
    await saveTokens(payload.accessToken, payload.refreshToken)
    setUser(payload.user)
  }, [])

  const signOut = useCallback(async () => {
    try {
      await apiClient.logout()
    } catch {
      // Even if the network call fails, clear the device.
    }
    await clearTokens()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut, refreshUser }),
    [user, loading, signIn, signUp, signOut, refreshUser],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession must be used inside SessionProvider')
  return context
}
