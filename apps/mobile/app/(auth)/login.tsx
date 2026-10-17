import { useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSession } from '../../lib/session'
import { apiClient } from '../../lib/api'
import { colors, radius, spacing } from '../../lib/theme'

type Mode = 'signin' | 'signup' | 'forgot'

export default function LoginScreen() {
  const { signIn, signUp } = useSession()
  const [mode, setMode] = useState<Mode>('signin')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [acceptWaiver, setAcceptWaiver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'signin') {
        await signIn(identifier.trim(), password)
      } else if (mode === 'signup') {
        if (!acceptWaiver) throw new Error('Please accept the liability waiver to join.')
        await signUp({
          email: email.trim(),
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || undefined,
          acceptWaiver: true,
        })
      } else {
        await apiClient.forgotPassword(email.trim())
        setNotice('If that email is on file, a reset link is on its way. Check your inbox.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Text style={styles.brandMark}>IH</Text>
          <Text style={styles.brandName}>Ironhouse Gym</Text>
        </View>

        <Text style={styles.headline}>
          {mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Join the gym' : 'Reset your password'}
        </Text>
        <Text style={styles.sub}>
          {mode === 'signin'
            ? 'Book classes, see your visits and check in with your phone.'
            : mode === 'signup'
              ? 'Create your account, then pick a plan at the gym or in the app.'
              : 'We will email you a link to choose a new password.'}
        </Text>

        {mode === 'signin' ? (
          <>
            <Text style={styles.label}>Email or phone</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
              value={identifier}
              onChangeText={setIdentifier}
              placeholder="you@example.com"
              placeholderTextColor={colors.ink400}
            />
          </>
        ) : null}

        {mode !== 'signin' ? (
          <>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.ink400}
            />
          </>
        ) : null}

        {mode === 'signup' ? (
          <>
            <View style={styles.row}>
              <View style={styles.half}>
                <Text style={styles.label}>First name</Text>
                <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} />
              </View>
              <View style={styles.half}>
                <Text style={styles.label}>Last name</Text>
                <TextInput style={styles.input} value={lastName} onChangeText={setLastName} />
              </View>
            </View>
            <Text style={styles.label}>Phone (for SMS reminders, optional)</Text>
            <TextInput style={styles.input} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />

            <Pressable style={styles.checkboxRow} onPress={() => setAcceptWaiver((value) => !value)}>
              <View style={[styles.checkbox, acceptWaiver && styles.checkboxOn]}>{acceptWaiver ? <Text style={styles.tick}>✓</Text> : null}</View>
              <Text style={styles.checkboxText}>
                I accept the liability waiver and the privacy policy (GDPR-style: you can export or erase your data any time).
              </Text>
            </Pressable>
          </>
        ) : null}

        {mode !== 'forgot' ? (
          <>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              placeholderTextColor={colors.ink400}
            />
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={submit} disabled={busy}>
          <Text style={styles.buttonText}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </Text>
        </Pressable>

        <View style={styles.links}>
          {mode === 'signin' ? (
            <>
              <Pressable onPress={() => setMode('signup')}>
                <Text style={styles.link}>New here? Create an account</Text>
              </Pressable>
              <Pressable onPress={() => setMode('forgot')}>
                <Text style={styles.link}>Forgot password?</Text>
              </Pressable>
            </>
          ) : (
            <Pressable onPress={() => setMode('signin')}>
              <Text style={styles.link}>Back to sign in</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.hint}>
          Demo member: member@ironhouse.test · password Passw0rd!{'\n'}
          Trainers and staff sign in with the same form.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ink950 },
  container: { padding: spacing.xl, paddingTop: 72, gap: spacing.sm },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  brandMark: {
    backgroundColor: colors.lime,
    color: colors.ink950,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  brandName: { color: colors.ink100, fontSize: 16, fontWeight: '600' },
  headline: { color: colors.ink100, fontSize: 26, fontWeight: '700' },
  sub: { color: colors.ink300, fontSize: 14, marginBottom: spacing.lg, lineHeight: 20 },
  label: { color: colors.ink300, fontSize: 12, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.ink900,
    borderColor: colors.ink700,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.ink100,
    fontSize: 15,
  },
  row: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
  checkboxRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignItems: 'flex-start' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.ink600,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.lime, borderColor: colors.lime },
  tick: { color: colors.ink950, fontWeight: '800' },
  checkboxText: { color: colors.ink300, fontSize: 12, flex: 1, lineHeight: 18 },
  button: {
    backgroundColor: colors.lime,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.ink950, fontWeight: '700', fontSize: 16 },
  links: { marginTop: spacing.lg, gap: spacing.sm },
  link: { color: colors.lime, fontSize: 14 },
  error: { color: colors.rose, fontSize: 13, marginTop: spacing.md },
  notice: { color: colors.emerald, fontSize: 13, marginTop: spacing.md },
  hint: { color: colors.ink400, fontSize: 12, marginTop: spacing.xl, lineHeight: 18 },
})
