import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { apiClient } from '../../lib/api'
import { useSession } from '../../lib/session'
import { colors, radius, spacing } from '../../lib/theme'

interface Profile {
  user: { firstName: string; lastName: string; email: string; phone: string | null; role: string }
  profile: {
    dateOfBirth: string | null
    emergencyContactName: string | null
    emergencyContactPhone: string | null
    healthNotes: string | null
    waiverSignedAt: string | null
    marketingOptIn: boolean
  } | null
}

export default function ProfileScreen() {
  const { user, signOut, refreshUser } = useSession()
  const [data, setData] = useState<Profile | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')
  const [healthNotes, setHealthNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const payload = (await apiClient.me()) as unknown as Profile
    setData(payload)
    setFirstName(payload.user.firstName)
    setLastName(payload.user.lastName)
    setPhone(payload.user.phone ?? '')
    setEmergencyName(payload.profile?.emergencyContactName ?? '')
    setEmergencyPhone(payload.profile?.emergencyContactPhone ?? '')
    setHealthNotes(payload.profile?.healthNotes ?? '')
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setBusy(true)
    setNotice(null)
    try {
      await apiClient.updateMe({
        firstName,
        lastName,
        phone: phone || undefined,
        emergencyContactName: emergencyName || undefined,
        emergencyContactPhone: emergencyPhone || undefined,
        healthNotes: healthNotes || undefined,
      })
      await refreshUser()
      setNotice('Profile saved')
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  async function eraseAccount() {
    Alert.alert(
      'Erase my account',
      'Your personal details, health notes and sessions are removed. Payment records stay for accounting. This cannot be undone.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Erase everything',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.deleteMe('Member requested erasure in the app')
              await signOut()
            } catch (caught) {
              Alert.alert('Could not erase', caught instanceof Error ? caught.message : 'Try again')
            }
          },
        },
      ],
    )
  }

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.lime} />
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.email}>{data.user.email}</Text>
        <Text style={styles.role}>Role: {data.user.role}</Text>
        <Text style={styles.role}>
          Waiver: {data.profile?.waiverSignedAt ? `signed ${new Date(data.profile.waiverSignedAt).toLocaleDateString()}` : 'not signed'}
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Personal details</Text>
      <Text style={styles.label}>First name</Text>
      <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} />
      <Text style={styles.label}>Last name</Text>
      <TextInput style={styles.input} value={lastName} onChangeText={setLastName} />
      <Text style={styles.label}>Phone</Text>
      <TextInput style={styles.input} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />

      <Text style={styles.sectionTitle}>Emergency contact</Text>
      <TextInput
        style={styles.input}
        placeholder="Name"
        placeholderTextColor={colors.ink400}
        value={emergencyName}
        onChangeText={setEmergencyName}
      />
      <TextInput
        style={[styles.input, styles.spaced]}
        placeholder="Phone"
        placeholderTextColor={colors.ink400}
        keyboardType="phone-pad"
        value={emergencyPhone}
        onChangeText={setEmergencyPhone}
      />

      <Text style={styles.sectionTitle}>Health notes</Text>
      <Text style={styles.hint}>Shared with the trainer of any class you book, so they can adapt the session.</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        multiline
        value={healthNotes}
        onChangeText={setHealthNotes}
        placeholder="e.g. mild asthma, inhaler in my bag"
        placeholderTextColor={colors.ink400}
      />

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <Pressable style={[styles.button, busy && styles.disabled]} onPress={save} disabled={busy}>
        <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Save changes'}</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Privacy</Text>
      <Pressable style={styles.secondary} onPress={() => Alert.alert('Your data', 'Email help@ironhouse.test and we will send a full export of your account data within 30 days, as required by GDPR.')}>
        <Text style={styles.secondaryText}>Request a data export</Text>
      </Pressable>
      <Pressable style={[styles.secondary, styles.danger]} onPress={eraseAccount}>
        <Text style={styles.dangerText}>Erase my account</Text>
      </Pressable>

      <Pressable style={styles.signOut} onPress={signOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>

      <Text style={styles.footer}>Signed in as {user?.email}</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 64 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink950 },
  card: { backgroundColor: colors.ink900, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  email: { color: colors.ink100, fontSize: 15, fontWeight: '600' },
  role: { color: colors.ink400, fontSize: 12 },
  sectionTitle: { color: colors.ink100, fontSize: 15, fontWeight: '700', marginTop: spacing.xl },
  label: { color: colors.ink300, fontSize: 12, marginTop: spacing.sm },
  hint: { color: colors.ink400, fontSize: 11, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.ink900,
    borderColor: colors.ink700,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.ink100,
    fontSize: 15,
    marginTop: spacing.xs,
  },
  spaced: { marginTop: spacing.sm },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  notice: { color: colors.emerald, fontSize: 13, marginTop: spacing.md },
  button: { backgroundColor: colors.lime, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  disabled: { opacity: 0.6 },
  buttonText: { color: colors.ink950, fontWeight: '700', fontSize: 15 },
  secondary: { borderColor: colors.ink600, borderWidth: 1, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', marginTop: spacing.sm },
  secondaryText: { color: colors.ink200, fontSize: 14 },
  danger: { borderColor: colors.rose },
  dangerText: { color: colors.rose, fontSize: 14, fontWeight: '600' },
  signOut: { marginTop: spacing.xl, alignItems: 'center' },
  signOutText: { color: colors.ink400, fontSize: 13 },
  footer: { color: colors.ink400, fontSize: 11, marginTop: spacing.lg, textAlign: 'center' },
})
