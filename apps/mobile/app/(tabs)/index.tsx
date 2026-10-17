import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { apiClient, type HomePayload } from '../../lib/api'
import { useSession } from '../../lib/session'
import { colors, formatDateTime, radius, spacing, statusColor } from '../../lib/theme'

export default function HomeScreen() {
  const { user } = useSession()
  const [home, setHome] = useState<HomePayload | null>(null)
  const [pass, setPass] = useState<{ token: string; expiresAt: string } | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const payload = await apiClient.home()
      setHome(payload)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your gym')
    }
  }, [])

  const issuePass = useCallback(async () => {
    try {
      const fresh = await apiClient.pass()
      setPass(fresh)
      setSecondsLeft(Math.max(0, Math.round((new Date(fresh.expiresAt).getTime() - Date.now()) / 1000)))
    } catch {
      setPass(null)
    }
  }, [])

  useEffect(() => {
    void load()
    void issuePass()
  }, [load, issuePass])

  // The pass rotates: a screenshot is worthless by the time it is shared.
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          void issuePass()
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [issuePass])

  async function cancel(bookingId: string) {
    try {
      await apiClient.cancelBooking(bookingId)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not cancel')
    }
  }

  if (!home) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.lime} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    )
  }

  const { entitlement } = home

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.lime}
          onRefresh={async () => {
            setRefreshing(true)
            await load()
            await issuePass()
            setRefreshing(false)
          }}
        />
      }
    >
      <Text style={styles.greeting}>Hi {user?.firstName}</Text>

      <View style={[styles.card, { borderColor: entitlement.allowed ? colors.lime : colors.rose }]}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardLabel}>{home.plan?.name ?? 'No active plan'}</Text>
            <Text style={styles.cardSub}>{entitlement.reason}</Text>
          </View>
          <Text style={[styles.pill, { color: statusColor(entitlement.status) }]}>{entitlement.status ?? 'NONE'}</Text>
        </View>

        <View style={styles.metaRow}>
          <View>
            <Text style={styles.metaLabel}>Valid until</Text>
            <Text style={styles.metaValue}>{entitlement.endsAt ? formatDateTime(entitlement.endsAt).split(',')[0] : '—'}</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Credits</Text>
            <Text style={styles.metaValue}>
              {entitlement.creditsRemaining === null ? 'Unlimited' : entitlement.creditsRemaining}
            </Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Auto-renew</Text>
            <Text style={styles.metaValue}>{entitlement.autoRenew ? 'On' : 'Off'}</Text>
          </View>
        </View>

        {entitlement.frozenUntil ? (
          <Text style={styles.frozen}>Frozen until {formatDateTime(entitlement.frozenUntil).split(',')[0]}</Text>
        ) : null}
      </View>

      <View style={styles.qrCard}>
        <Text style={styles.sectionTitle}>Check-in pass</Text>
        <Text style={styles.qrHint}>Show this at the desk. It refreshes every 90 seconds.</Text>
        <View style={styles.qrBox}>
          {pass ? <QRCode value={pass.token} size={190} backgroundColor="#ffffff" color="#07090c" /> : <ActivityIndicator color={colors.lime} />}
        </View>
        <Text style={styles.qrTimer}>{pass ? `Valid for ${secondsLeft}s` : 'Tap to generate'}</Text>
        <Pressable onPress={issuePass} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Refresh pass</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Next classes</Text>
      {home.upcoming.length === 0 ? (
        <Text style={styles.empty}>Nothing booked. Head to the Classes tab to grab a spot.</Text>
      ) : (
        home.upcoming.map((booking) => (
          <View key={booking.bookingId} style={styles.listItem}>
            <View style={styles.flex}>
              <Text style={styles.itemTitle}>{booking.title}</Text>
              <Text style={styles.itemSub}>
                {formatDateTime(booking.startsAt)} · {booking.trainerName ?? 'Trainer TBC'}
              </Text>
              <Text style={[styles.itemStatus, { color: statusColor(booking.bookingStatus) }]}>
                {booking.bookingStatus}
                {booking.waitlistPosition ? ` · position ${booking.waitlistPosition}` : ''}
                {booking.checkedIn ? ' · checked in' : ''}
              </Text>
            </View>
            <Pressable onPress={() => cancel(booking.bookingId)} style={styles.smallButton}>
              <Text style={styles.smallButtonText}>Cancel</Text>
            </Pressable>
          </View>
        ))
      )}

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{home.stats.classesAttended}</Text>
          <Text style={styles.statLabel}>classes (30d)</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{home.stats.noShows}</Text>
          <Text style={styles.statLabel}>no-shows</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{home.unreadNotifications}</Text>
          <Text style={styles.statLabel}>alerts</Text>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink950, gap: spacing.md },
  greeting: { color: colors.ink300, fontSize: 14 },
  card: {
    backgroundColor: colors.ink850,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardLabel: { color: colors.ink100, fontSize: 18, fontWeight: '700' },
  cardSub: { color: colors.ink300, fontSize: 13, marginTop: 2 },
  pill: { fontSize: 12, fontWeight: '700' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  metaLabel: { color: colors.ink400, fontSize: 11, textTransform: 'uppercase' },
  metaValue: { color: colors.ink100, fontSize: 15, fontWeight: '600', marginTop: 2 },
  frozen: { color: colors.amber, fontSize: 12 },
  qrCard: { backgroundColor: colors.ink850, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
  qrHint: { color: colors.ink300, fontSize: 12, textAlign: 'center' },
  qrBox: { backgroundColor: '#fff', padding: spacing.md, borderRadius: radius.md, marginTop: spacing.sm },
  qrTimer: { color: colors.lime, fontSize: 12 },
  secondaryButton: { borderColor: colors.ink600, borderWidth: 1, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: spacing.lg },
  secondaryText: { color: colors.ink200, fontSize: 13 },
  sectionTitle: { color: colors.ink100, fontSize: 16, fontWeight: '700', marginTop: spacing.sm },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.ink900,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  flex: { flex: 1 },
  itemTitle: { color: colors.ink100, fontSize: 15, fontWeight: '600' },
  itemSub: { color: colors.ink300, fontSize: 12, marginTop: 2 },
  itemStatus: { fontSize: 11, marginTop: 4, fontWeight: '600' },
  smallButton: { borderColor: colors.ink600, borderWidth: 1, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: spacing.md },
  smallButtonText: { color: colors.ink200, fontSize: 12 },
  empty: { color: colors.ink400, fontSize: 13 },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.ink900, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  statValue: { color: colors.lime, fontSize: 20, fontWeight: '700' },
  statLabel: { color: colors.ink400, fontSize: 11, marginTop: 2, textAlign: 'center' },
  error: { color: colors.rose, fontSize: 13 },
})
