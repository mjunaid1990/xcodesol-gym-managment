import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { apiClient } from '../../lib/api'
import { colors, formatDateTime, formatMoney, radius, spacing, statusColor } from '../../lib/theme'

type Tab = 'visits' | 'payments'

export default function HistoryScreen() {
  const [tab, setTab] = useState<Tab>('visits')
  const [visits, setVisits] = useState<Awaited<ReturnType<typeof apiClient.visits>>['rows']>([])
  const [payments, setPayments] = useState<Awaited<ReturnType<typeof apiClient.payments>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [visitData, paymentData] = await Promise.all([apiClient.visits(), apiClient.payments()])
      setVisits(visitData.rows ?? [])
      setPayments(paymentData)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your history')
    } finally {
      setLoading(false)
    }
  }, [])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  useEffect(() => {
    void load()
  }, [load])

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
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.lime} onRefresh={onRefresh} />}
    >
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={load} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.tabs}>
        {(['visits', 'payments'] as Tab[]).map((option) => (
          <Text
            key={option}
            onPress={() => setTab(option)}
            style={[styles.tab, tab === option && styles.tabActive]}
          >
            {option === 'visits' ? `Visits (${visits.length})` : 'Payments'}
          </Text>
        ))}
      </View>

      {tab === 'visits' ? (
        visits.length === 0 ? (
          <Text style={styles.empty}>No visits yet. Your first check-in will show up here.</Text>
        ) : (
          visits.map((visit) => (
            <View key={visit.id} style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.title}>{visit.sessionTitle ?? 'Gym floor'}</Text>
                <Text style={styles.meta}>
                  {formatDateTime(visit.checkedInAt)} · {visit.method}
                </Text>
              </View>
              <Text style={styles.branch}>{visit.branchName ?? ''}</Text>
            </View>
          ))
        )
      ) : (
        <>
          {payments ? (
            <View style={styles.totals}>
              <View>
                <Text style={styles.meta}>Lifetime</Text>
                <Text style={styles.totalValue}>{formatMoney(payments.totals.lifetimeCents)}</Text>
              </View>
              <View>
                <Text style={styles.meta}>Refunded</Text>
                <Text style={styles.totalValue}>{formatMoney(payments.totals.refundedCents)}</Text>
              </View>
              <View>
                <Text style={styles.meta}>Failed attempts</Text>
                <Text style={[styles.totalValue, { color: payments.totals.failedCount ? colors.rose : colors.ink100 }]}>
                  {payments.totals.failedCount}
                </Text>
              </View>
            </View>
          ) : null}

          {payments?.payments.length === 0 ? <Text style={styles.empty}>No payments yet.</Text> : null}
          {payments?.payments.map((payment) => (
            <View key={payment.id} style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.title}>{payment.description ?? payment.invoiceNumber ?? 'Payment'}</Text>
                <Text style={styles.meta}>{formatDateTime(payment.createdAt)}</Text>
              </View>
              <View style={styles.right}>
                <Text style={styles.amount}>{formatMoney(payment.amountCents, payment.currency)}</Text>
                <Text style={[styles.status, { color: statusColor(payment.status) }]}>{payment.status}</Text>
              </View>
            </View>
          ))}

          {payments && payments.invoices.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Receipts</Text>
              {payments.invoices.slice(0, 10).map((invoice) => (
                <View key={invoice.id} style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={styles.title}>{invoice.number}</Text>
                    <Text style={styles.meta}>{formatDateTime(invoice.issuedAt)}</Text>
                  </View>
                  <View style={styles.right}>
                    <Text style={styles.amount}>{formatMoney(invoice.totalCents)}</Text>
                    <Text style={[styles.status, { color: statusColor(invoice.status) }]}>{invoice.status}</Text>
                  </View>
                </View>
              ))}
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 48, backgroundColor: colors.ink950 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink950 },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  tab: {
    flex: 1,
    textAlign: 'center',
    paddingVertical: 10,
    borderRadius: radius.sm,
    color: colors.ink300,
    backgroundColor: colors.ink900,
    overflow: 'hidden',
  },
  tabActive: { backgroundColor: colors.lime, color: colors.ink950, fontWeight: '700' },
  row: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.ink900, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  flex: { flex: 1 },
  title: { color: colors.ink100, fontSize: 14, fontWeight: '600' },
  meta: { color: colors.ink400, fontSize: 11, marginTop: 2 },
  branch: { color: colors.ink400, fontSize: 11, maxWidth: 90, textAlign: 'right' },
  amount: { color: colors.ink100, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  status: { fontSize: 10, textAlign: 'right', marginTop: 2, fontWeight: '700' },
  right: { alignItems: 'flex-end' },
  totals: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.ink900,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  totalValue: { color: colors.ink100, fontSize: 16, fontWeight: '700', marginTop: 2 },
  sectionTitle: { color: colors.ink100, fontSize: 15, fontWeight: '700', marginTop: spacing.lg },
  empty: { color: colors.ink400, fontSize: 13, marginTop: spacing.md },
  errorBox: { backgroundColor: colors.ink900, borderWidth: 1, borderColor: colors.rose, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
  errorText: { color: colors.rose, fontSize: 13 },
  retryButton: { alignSelf: 'flex-start', backgroundColor: colors.ink800, borderColor: colors.ink700, borderWidth: 1, paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.sm },
  retryButtonText: { color: colors.white, fontSize: 12, fontWeight: '600' },
})
