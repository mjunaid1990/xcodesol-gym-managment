import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { apiClient, type SessionOption } from '../../lib/api'
import { colors, formatTime, radius, spacing } from '../../lib/theme'

interface RosterMember {
  bookingId: string
  memberId: string
  firstName: string
  lastName: string
  status: string
  checkedIn: boolean
  healthNotes: string | null
}

export default function TrainerScreen() {
  const [sessions, setSessions] = useState<SessionOption[]>([])
  const [rosters, setRosters] = useState<Record<string, RosterMember[]>>({})
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const day = await apiClient.trainerDay()
      setSessions(day.sessions)
      if (day.sessions[0]) await loadRoster(day.sessions[0].id)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRoster = useCallback(async (sessionId: string) => {
    try {
      // The roster endpoint is staff-scoped: trainers have class:read.
      const { API_BASE, getAccessToken } = await import('../../lib/api')
      const token = await getAccessToken()
      const response = await fetch(`${API_BASE}/api/v1/classes/${sessionId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!response.ok) return
      const payload = (await response.json()) as { data: { roster: RosterMember[] } }
      setRosters((current) => ({ ...current, [sessionId]: payload.data.roster }))
    } catch {
      // Offline: the class list still renders.
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function checkIn(sessionId: string, memberId: string) {
    try {
      await apiClient.trainerCheckIn(sessionId, memberId)
      await loadRoster(sessionId)
      Alert.alert('Checked in', 'Attendance recorded for this member.')
    } catch (caught) {
      Alert.alert('Could not check in', caught instanceof Error ? caught.message : 'Try again')
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
    <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl refreshing={false} tintColor={colors.lime} onRefresh={load} />}>
      <Text style={styles.heading}>Today&apos;s classes</Text>
      {sessions.length === 0 ? <Text style={styles.empty}>No classes assigned to you today.</Text> : null}

      {sessions.map((session) => {
        const roster = rosters[session.id] ?? []
        const isOpen = expanded === session.id
        const checkedIn = roster.filter((member) => member.checkedIn).length

        return (
          <View key={session.id} style={styles.card}>
            <Pressable
              onPress={() => {
                const next = isOpen ? null : session.id
                setExpanded(next)
                if (next) void loadRoster(session.id)
              }}
            >
              <Text style={styles.time}>{formatTime(session.startsAt)} – {formatTime(session.endsAt)}</Text>
              <Text style={styles.title}>{session.title}</Text>
              <Text style={styles.meta}>
                {session.roomName ?? 'Floor'} · {session.bookedCount}/{session.capacity} booked · {checkedIn} checked in
              </Text>
            </Pressable>

            {isOpen ? (
              <View style={styles.roster}>
                {roster.length === 0 ? <Text style={styles.empty}>Nobody booked yet.</Text> : null}
                {roster.map((member) => (
                  <View key={member.bookingId} style={styles.memberRow}>
                    <View style={styles.flex}>
                      <Text style={styles.memberName}>
                        {member.firstName} {member.lastName}
                      </Text>
                      <Text style={styles.memberMeta}>
                        {member.status}
                        {member.healthNotes ? ` · ${member.healthNotes}` : ''}
                      </Text>
                    </View>
                    {member.checkedIn ? (
                      <Text style={styles.checked}>✓ in</Text>
                    ) : (
                      <Pressable style={styles.checkButton} onPress={() => checkIn(session.id, member.memberId)}>
                        <Text style={styles.checkText}>Check in</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink950 },
  heading: { color: colors.ink100, fontSize: 20, fontWeight: '700' },
  card: { backgroundColor: colors.ink900, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  time: { color: colors.lime, fontSize: 12, fontWeight: '700' },
  title: { color: colors.ink100, fontSize: 16, fontWeight: '600', marginTop: 2 },
  meta: { color: colors.ink300, fontSize: 12, marginTop: 2 },
  roster: { borderTopColor: colors.ink700, borderTopWidth: 1, paddingTop: spacing.sm, gap: spacing.sm },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1 },
  memberName: { color: colors.ink100, fontSize: 14 },
  memberMeta: { color: colors.ink400, fontSize: 11 },
  checkButton: { backgroundColor: colors.lime, borderRadius: radius.sm, paddingVertical: 8, paddingHorizontal: spacing.md },
  checkText: { color: colors.ink950, fontWeight: '700', fontSize: 12 },
  checked: { color: colors.emerald, fontSize: 12, fontWeight: '700' },
  empty: { color: colors.ink400, fontSize: 13 },
})
