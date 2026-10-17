import { getDb } from '@/lib/db/client'
import { requireStaffUser } from '@/lib/auth/current-user'
import { getSettingSections } from '@/lib/services/settings'
import { listBranches } from '@/lib/services/catalog'
import { can, type Role } from '@/lib/constants'
import { ActionForm } from '@/components/ActionForm'
import { Badge, Card, Field, PageHeader, Table, formatDateTime, inputClass } from '@/components/ui'

export const metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

interface CheckinSettings {
  qrEnabled?: boolean
  qrTtlSeconds?: number
  allowManualOverride?: boolean
  cooldownMinutes?: number
}
interface BillingSettings {
  autoRenewReminderDays?: number
  retryFailedPayments?: boolean
  taxRatePercent?: number
}
interface ClassSettings {
  defaultCancelWindowHours?: number
  defaultCapacity?: number
  waitlistEnabled?: boolean
  autoPromoteWaitlist?: boolean
}
interface GymSettings {
  name?: string
  supportEmail?: string
  supportPhone?: string
  currency?: string
}

export default async function SettingsPage() {
  const user = await requireStaffUser('setting:read')
  const db = await getDb()
  const [sections, branchRows] = await Promise.all([getSettingSections(db), listBranches(db, false)])

  const gym = sections.gym as GymSettings
  const checkin = sections.checkin as CheckinSettings
  const billing = sections.billing as BillingSettings
  const classes = sections.classes as ClassSettings
  const canWrite = can(user.role as Role, 'setting:write')

  const integrations = [
    { name: 'Payments', value: process.env.STRIPE_SECRET_KEY ? 'Stripe (live keys)' : 'Mock provider', ok: Boolean(process.env.STRIPE_SECRET_KEY), hint: 'Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Vercel' },
    { name: 'Email', value: process.env.RESEND_API_KEY ? 'Resend' : 'Simulated', ok: Boolean(process.env.RESEND_API_KEY), hint: 'Verification, receipts and reminders' },
    { name: 'SMS', value: process.env.TWILIO_ACCOUNT_SID ? 'Twilio' : 'Simulated', ok: Boolean(process.env.TWILIO_ACCOUNT_SID), hint: 'Expiry reminders and waitlist promotions' },
    { name: 'Push', value: 'Expo push', ok: true, hint: 'Uses device tokens registered by the app' },
    { name: 'Scheduled jobs', value: process.env.CRON_SECRET ? 'Vercel Cron configured' : 'Open (set CRON_SECRET)', ok: Boolean(process.env.CRON_SECRET), hint: '/api/cron/expiry, /reminders, /retries, /noshow' },
    { name: 'Database', value: process.env.DATABASE_URL ? 'Managed Postgres (pooled)' : 'Embedded PGlite (local)', ok: Boolean(process.env.DATABASE_URL), hint: 'Set DATABASE_URL to a Neon pooled connection string' },
  ]

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={`Last updated ${formatDateTime(sections.updatedAt)} · values are stored in the database and audited`}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Gym profile">
          <ActionForm
            endpoint="/api/v1/settings"
            method="PATCH"
            submitLabel={canWrite ? 'Save' : 'Read only'}
            successMessage="Saved"
            extra={{ section: 'gym' }}
            className="grid gap-3 md:grid-cols-2"
          >
            <Field label="Gym name" htmlFor="name">
              <input id="name" name="name" defaultValue={gym.name ?? ''} disabled={!canWrite} className={inputClass} />
            </Field>
            <Field label="Currency" htmlFor="currency">
              <input id="currency" name="currency" defaultValue={gym.currency ?? 'USD'} disabled={!canWrite} className={inputClass} />
            </Field>
            <Field label="Support email" htmlFor="supportEmail">
              <input id="supportEmail" name="supportEmail" defaultValue={gym.supportEmail ?? ''} disabled={!canWrite} className={inputClass} />
            </Field>
            <Field label="Support phone" htmlFor="supportPhone">
              <input id="supportPhone" name="supportPhone" defaultValue={gym.supportPhone ?? ''} disabled={!canWrite} className={inputClass} />
            </Field>
          </ActionForm>
        </Card>

        <Card title="Check-in rules">
          <ActionForm
            endpoint="/api/v1/settings"
            method="PATCH"
            submitLabel={canWrite ? 'Save' : 'Read only'}
            coerce={{ qrTtlSeconds: 'number', cooldownMinutes: 'number' }}
            extra={{ section: 'checkin' }}
            className="grid gap-3 md:grid-cols-2"
          >
            <Field label="QR pass lifetime (seconds)" htmlFor="qrTtlSeconds" hint="Short window stops screenshots being reused">
              <input
                id="qrTtlSeconds"
                name="qrTtlSeconds"
                type="number"
                min={30}
                max={600}
                defaultValue={checkin.qrTtlSeconds ?? 90}
                disabled={!canWrite}
                className={inputClass}
              />
            </Field>
            <Field label="Duplicate scan cooldown (minutes)" htmlFor="cooldownMinutes">
              <input
                id="cooldownMinutes"
                name="cooldownMinutes"
                type="number"
                min={0}
                max={240}
                defaultValue={checkin.cooldownMinutes ?? 30}
                disabled={!canWrite}
                className={inputClass}
              />
            </Field>
          </ActionForm>
        </Card>

        <Card title="Billing & retries">
          <ActionForm
            endpoint="/api/v1/settings"
            method="PATCH"
            submitLabel={canWrite ? 'Save' : 'Read only'}
            coerce={{ autoRenewReminderDays: 'number', taxRatePercent: 'number' }}
            extra={{ section: 'billing' }}
            className="grid gap-3 md:grid-cols-2"
          >
            <Field label="Renewal reminder (days before)" htmlFor="autoRenewReminderDays">
              <input
                id="autoRenewReminderDays"
                name="autoRenewReminderDays"
                type="number"
                min={1}
                max={30}
                defaultValue={billing.autoRenewReminderDays ?? 7}
                disabled={!canWrite}
                className={inputClass}
              />
            </Field>
            <Field label="Tax rate (%)" htmlFor="taxRatePercent" hint="Prices are tax-inclusive; set 0 for no tax line">
              <input
                id="taxRatePercent"
                name="taxRatePercent"
                type="number"
                min={0}
                max={30}
                defaultValue={billing.taxRatePercent ?? 0}
                disabled={!canWrite}
                className={inputClass}
              />
            </Field>
            <p className="text-xs text-ink-400 md:col-span-2">
              Failed payments are retried by the nightly job {billing.retryFailedPayments === false ? '(currently disabled)' : 'on days 1, 3 and 7'}.
            </p>
          </ActionForm>
        </Card>

        <Card title="Class defaults">
          <ActionForm
            endpoint="/api/v1/settings"
            method="PATCH"
            submitLabel={canWrite ? 'Save' : 'Read only'}
            coerce={{ defaultCancelWindowHours: 'number', defaultCapacity: 'number' }}
            extra={{ section: 'classes' }}
            className="grid gap-3 md:grid-cols-2"
          >
            <Field label="Free cancellation window (hours)" htmlFor="defaultCancelWindowHours">
              <input
                id="defaultCancelWindowHours"
                name="defaultCancelWindowHours"
                type="number"
                min={0}
                max={72}
                defaultValue={classes.defaultCancelWindowHours ?? 6}
                disabled={!canWrite}
                className={inputClass}
              />
            </Field>
            <Field label="Default capacity" htmlFor="defaultCapacity">
              <input
                id="defaultCapacity"
                name="defaultCapacity"
                type="number"
                min={1}
                max={200}
                defaultValue={classes.defaultCapacity ?? 20}
                disabled={!canWrite}
                className={inputClass}
              />
            </Field>
            <p className="text-xs text-ink-400 md:col-span-2">
              Waitlists: {classes.waitlistEnabled === false ? 'disabled' : 'enabled'}
              {classes.autoPromoteWaitlist === false ? ' · manual promotion' : ' · auto-promotion on cancellation'}
            </p>
          </ActionForm>
        </Card>
      </div>

      <Card className="mt-4" title="Integrations & jobs">
        <ul className="grid gap-3 md:grid-cols-2">
          {integrations.map((integration) => (
            <li key={integration.name} className="flex items-start justify-between gap-3 rounded-xl border border-ink-700 p-3">
              <div>
                <p className="text-sm font-medium">{integration.name}</p>
                <p className="text-xs text-ink-400">{integration.hint}</p>
              </div>
              <Badge tone={integration.ok ? 'positive' : 'warning'}>{integration.value}</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-4" title="Branches" padded={false}>
        <Table head={['Name', 'Slug', 'City', 'Timezone', 'Phone', 'Status']}>
          {branchRows.map((branch) => (
            <tr key={branch.id}>
              <td className="px-4 py-3 font-medium">{branch.name}</td>
              <td className="px-4 py-3 font-mono text-xs">{branch.slug}</td>
              <td className="px-4 py-3 text-ink-300">{branch.city ?? '—'}</td>
              <td className="px-4 py-3 text-ink-300">{branch.timezone}</td>
              <td className="px-4 py-3 text-ink-300">{branch.phone ?? '—'}</td>
              <td className="px-4 py-3">
                <Badge tone={branch.isActive ? 'positive' : 'neutral'}>{branch.isActive ? 'open' : 'closed'}</Badge>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="mt-4">
        <Card title="Data & privacy" description="GDPR-style controls">
          <ul className="space-y-2 text-sm text-ink-200">
            <li>• Members can export their own data and erase their account from the app (Profile → Privacy).</li>
            <li>• Erasure anonymises the member record and revokes every session, while keeping financial history intact for accounting.</li>
            <li>• Health notes and emergency contacts are only visible to staff and to the trainer teaching the class.</li>
            <li>• Card data never touches our servers: payments are confirmed directly with the provider.</li>
            <li>• Passwords are hashed with bcrypt; sessions are revocable per device from the member app.</li>
          </ul>
        </Card>
      </div>
    </>
  )
}
