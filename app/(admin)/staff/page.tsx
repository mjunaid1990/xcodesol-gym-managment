import Link from 'next/link'
import { getDb } from '@/lib/db/client'
import { requireStaffUser } from '@/lib/auth/current-user'
import { listStaff, payrollHours } from '@/lib/services/staff'
import { listBranches } from '@/lib/services/catalog'
import { can, ROLE_LABELS, ROLES, type Role } from '@/lib/constants'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import {
  Badge,
  Card,
  Field,
  PageHeader,
  StatCard,
  Table,
  formatDate,
  inputClass,
  money,
  selectClass,
  statusTone,
} from '@/components/ui'

export const metadata = { title: 'Staff & payroll' }
export const dynamic = 'force-dynamic'

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ role?: string; q?: string; branchId?: string }> }) {
  const user = await requireStaffUser('staff:read')
  const params = (await searchParams) ?? {}
  const db = await getDb()

  const range = { from: new Date(Date.now() - 30 * 86_400_000), to: new Date() }
  const [staffVal, payrollVal, branchRowsVal] = await Promise.allSettled([
    listStaff(db, { role: params.role, q: params.q, branchId: params.branchId }),
    payrollHours(db, range),
    listBranches(db),
  ])

  const staff = staffVal.status === 'fulfilled' ? staffVal.value : []
  const payroll = payrollVal.status === 'fulfilled' ? payrollVal.value : []
  const branchRows = branchRowsVal.status === 'fulfilled' ? branchRowsVal.value : []

  const canWrite = can(user.role as Role, 'staff:write')
  const totalHours = payroll.reduce((sum, row) => sum + row.taughtHours, 0)
  const totalGross = payroll.reduce((sum, row) => sum + (row.grossPayCents ?? 0), 0)

  return (
    <>
      <PageHeader
        title="Staff & payroll"
        subtitle="Roles, permissions and trained hours. Hours come from the published schedule (class time + 15 minutes of setup)."
        actions={
          <Link href="/api/v1/reports/export?type=classes" className="rounded-xl border border-ink-600 bg-ink-700 px-4 py-3 text-sm">
            Export timetable
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Team size" value={String(staff.length)} hint={`${staff.filter((row) => row.role === 'TRAINER').length} trainers`} />
        <StatCard label="Taught hours (30d)" value={String(totalHours)} tone="accent" />
        <StatCard label="Payroll estimate (30d)" value={money(Math.round(totalGross))} hint="Based on each person's hourly rate" />
      </div>

      <Card className="mt-4" title="Directory" padded={false}>
        <Table head={['Name', 'Role', 'Branch', 'Classes this month', 'Next 7 days', 'Rate', 'Status', '']}>
          {staff.map((person) => (
            <tr key={person.id} className="hover:bg-ink-800/40">
              <td className="px-4 py-3">
                <span className="font-medium">
                  {person.firstName} {person.lastName}
                </span>
                <p className="text-xs text-ink-400">{person.email}</p>
                <p className="text-xs text-ink-400">{person.jobTitle ?? '—'}</p>
              </td>
              <td className="px-4 py-3">
                <Badge tone={person.role === 'ADMIN' ? 'accent' : 'info'}>{ROLE_LABELS[person.role as Role] ?? person.role}</Badge>
              </td>
              <td className="px-4 py-3 text-ink-300">{person.branchName ?? 'All branches'}</td>
              <td className="px-4 py-3 stat-value">{person.sessionsThisMonth}</td>
              <td className="px-4 py-3 stat-value">{person.sessionsNext7d}</td>
              <td className="px-4 py-3">{person.hourlyRateCents ? money(person.hourlyRateCents) : '—'}</td>
              <td className="px-4 py-3">
                <Badge tone={statusTone(person.status)}>{person.status}</Badge>
                <p className="text-xs text-ink-400">last seen {formatDate(person.lastLoginAt)}</p>
              </td>
              <td className="px-4 py-3">
                {canWrite ? (
                  <span className="flex flex-wrap gap-2">
                    <ActionButton
                      endpoint={`/api/v1/staff/${person.id}`}
                      method="PATCH"
                      body={{ role: person.role === 'TRAINER' ? 'STAFF' : 'TRAINER' }}
                      label="Switch role"
                      title="Toggle trainer / front desk"
                    />
                    <ActionButton
                      endpoint={`/api/v1/staff/${person.id}`}
                      method="PATCH"
                      body={{ status: person.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }}
                      label={person.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                      variant={person.status === 'ACTIVE' ? 'danger' : 'secondary'}
                    />
                  </span>
                ) : (
                  <Link href={`/classes?trainerId=${person.id}`} className="text-xs text-ink-300 hover:text-white transition-colors">
                    Schedule →
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card className="mt-4" title="Payroll hours (last 30 days)" description="Export and hand to your payroll provider" padded={false}>
        <Table head={['Name', 'Role', 'Classes', 'Hours', 'Rate', 'Gross', 'Attendees']}>
          {payroll.map((row) => (
            <tr key={row.staffId}>
              <td className="px-4 py-3 font-medium">{row.name}</td>
              <td className="px-4 py-3 text-ink-300">{ROLE_LABELS[row.role as Role] ?? row.role}</td>
              <td className="px-4 py-3 stat-value">{row.sessions}</td>
              <td className="px-4 py-3 stat-value">{row.taughtHours}</td>
              <td className="px-4 py-3">{row.hourlyRateCents ? money(row.hourlyRateCents) : '—'}</td>
              <td className="px-4 py-3 stat-value">{row.grossPayCents ? money(row.grossPayCents) : '—'}</td>
              <td className="px-4 py-3 stat-value">{row.attendees}</td>
            </tr>
          ))}
        </Table>
      </Card>

      {canWrite ? (
        <Card className="mt-4" title="Add a team member" description="Trainers get the trainer view in the mobile app automatically">
          <ActionForm
            endpoint="/api/v1/staff"
            submitLabel="Create account"
            successMessage="Team member added"
            coerce={{ hourlyRateCents: 'number' }}
            className="grid gap-3 md:grid-cols-2"
          >
            <Field label="First name" htmlFor="staffFirst">
              <input id="staffFirst" name="firstName" required className={inputClass} />
            </Field>
            <Field label="Last name" htmlFor="staffLast">
              <input id="staffLast" name="lastName" required className={inputClass} />
            </Field>
            <Field label="Email" htmlFor="staffEmail">
              <input id="staffEmail" name="email" type="email" required className={inputClass} />
            </Field>
            <Field label="Phone" htmlFor="staffPhone">
              <input id="staffPhone" name="phone" className={inputClass} />
            </Field>
            <Field label="Role" htmlFor="staffRole">
              <select id="staffRole" name="role" className={selectClass} defaultValue="TRAINER">
                {ROLES.filter((role) => role !== 'MEMBER').map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Branch" htmlFor="staffBranch">
              <select id="staffBranch" name="branchId" className={selectClass} defaultValue={user.branchId ?? ''}>
                <option value="">All branches</option>
                {branchRows.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Job title" htmlFor="staffTitle">
              <input id="staffTitle" name="jobTitle" className={inputClass} placeholder="Head coach" />
            </Field>
            <Field label="Hourly rate (cents)" htmlFor="staffRate" hint="Used for the payroll estimate">
              <input id="staffRate" name="hourlyRateCents" type="number" min={0} className={inputClass} />
            </Field>
            <Field label="Temporary password" htmlFor="staffPassword" hint="They should change it on first sign-in">
              <input id="staffPassword" name="password" className={inputClass} defaultValue="Passw0rd!" />
            </Field>
          </ActionForm>
        </Card>
      ) : null}
    </>
  )
}
