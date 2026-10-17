import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { apiClient, type SessionOption } from '../../lib/api'
import { colors, formatDay, formatTime, radius, spacing, statusColor } from '../../lib/theme'

export default function ClassesScreen() {
  const [sessions, setSessions] = useState<SessionOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setSessions(await apiClient.sessions())
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load classes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const grouped = useMemo(() => {
    const byDay = new Map<string, SessionOption[]>()
    for (const session of sessions) {
      const key = new Date(session.startsAt).toDateString()
      byDay.set(key, [...(byDay.get(key) ?? []), session])
    }
    return Array.from(byDay.entries())
  }, [sessions])

  async function book(session: SessionOption) {
    setBusyId(session.id)
    try {
      const result = await apiClient.book(session.id)
      Alert.alert(result.waitlisted ? 'Added to the waitlist' : 'Booked', result.message)
      await load()
    } catch (caught) {
      Alert.alert('Could not book', caught instanceof Error ? caught.message : 'Try again at the desk')
    } finally {
      setBusyId(null)
    }
  }

  async function cancel(session: SessionOption) {
    if (!session.myBooking) return
    setBusyId(session.id)
    try {
      const result = await apiClient.cancelBooking(session.myBooking.id)
      Alert.alert(
        result.late ? 'Cancelled late' : 'Cancelled',
        result.penaltyCents > 0
          ? `A late fee of ${(result.penaltyCents / 100).toFixed(2)} was added to your account.`
          : 'Your spot was released and your credit returned.',
      )
      await load()
    } catch (caught) {
      Alert.alert('Could not cancel', caught instanceof Error ? caught.message : 'Try again')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.lime} />
      </View>
    )
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={false} tintColor={colors.lime} onRefresh={load} />}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {grouped.map(([day, daySessions]) => (
        <View key={day} style={styles.dayBlock}>
          <Text style={styles.dayLabel}>{formatDay(daySessions[0]!.startsAt)}</Text>
          {daySessions.map((session) => {
            const full = session.spotsLeft <= 0
            const mine = session.myBooking
            return (
              <View key={session.id} style={styles.item}>
                <View style={styles.itemHeader}>
                  <View style={styles.flex}>
                    <Text style={styles.itemTitle}>{session.title}</Text>
                    <Text style={styles.itemSub}>
                      {formatTime(session.startsAt)} · {session.trainerName ?? 'Trainer TBC'} · {session.roomName ?? 'Floor'}
                    </Text>
                    <Text style={styles.itemSub}>
                      {session.bookedCount}/{session.capacity} booked
                      {session.waitlistCount > 0 ? ` · ${session.waitlistCount} waiting` : ''}
                      {session.creditCost > 1 ? ` · ${session.creditCost} credits` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.slots, { color: full ? colors.amber : colors.emerald }]}>
                    {full ? 'Full' : `${session.spotsLeft} left`}
                  </Text>
                </View>

                {mine ? (
                  <View style={styles.bookingRow}>
                    <Text style={[styles.mine, { color: statusColor(mine.status) }]}>
                      {mine.status}
                      {mine.waitlistPosition ? ` · #${mine.waitlistPosition}` : ''}
                    </Text>
                    <Pressable style={styles.cancelButton} onPress={() => cancel(session)} disabled={busyId === session.id}>
                      <Text style={styles.cancelText}>{busyId === session.id ? '…' : 'Cancel'}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    style={[styles.bookButton, busyId === session.id && styles.disabled]}
                    onPress={() => book(session)}
                    disabled={busyId === session.id || session.status !== 'SCHEDULED'}
                  >
                    <Text style={styles.bookText}>
                      {session.status !== 'SCHEDULED' ? 'Cancelled' : full ? 'Join waitlist' : 'Book'}
                    </Text>
                  </Pressable>
                )}
              </View>
            )
          })}
        </View>
      ))}

      <Text style={styles.footnote}>
        Free cancellation up to the class window; inside the window a fee may apply. Waitlist spots are promoted
        automatically and you get a push notification.
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 48, backgroundColor: colors.ink950 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink950 },
  dayBlock: { gap: spacing.sm },
  dayLabel: { color: colors.ink300, fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  item: { backgroundColor: colors.ink900, borderWidth: 1, borderColor: colors.ink700, borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  itemHeader: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  itemTitle: { color: colors.ink100, fontSize: 15, fontWeight: '600' },
  itemSub: { color: colors.ink300, fontSize: 12, marginTop: 2 },
  slots: { fontSize: 12, fontWeight: '700' },
  bookButton: { backgroundColor: colors.white, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  bookText: { color: colors.ink950, fontWeight: '700', fontSize: 14 },
  bookingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mine: { fontSize: 12, fontWeight: '700' },
  cancelButton: { borderColor: colors.ink700, backgroundColor: colors.ink800, borderWidth: 1, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: spacing.md },
  cancelText: { color: colors.ink200, fontSize: 12 },
  disabled: { opacity: 0.6 },
  footnote: { color: colors.ink400, fontSize: 11, lineHeight: 16 },
  error: { color: colors.rose, fontSize: 13 },
})
