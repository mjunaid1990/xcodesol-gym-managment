import Link from 'next/link'
import { getDb } from '@/lib/db/client'
import { requireStaffUser } from '@/lib/auth/current-user'
import { listMembers } from '@/lib/services/members'
import { can, type Role } from '@/lib/constants'
import { Filters } from '@/components/Filters'
import { MemberTable, type MemberRow } from '@/components/MemberTable'
import { ActionForm } from '@/components/ActionForm'
import { Button, Card, EmptyState, Field, PageHeader, inputClass, selectClass } from '@/components/ui'

export const metadata = { title: 'Members' }
export const dynamic = 'force-dynamic'

interface SearchParams {
  q?: string
  status?: string
  membershipStatus?: string
  branchId?: string
  hasWaiver?: string
  inactiveForDays?: string
  sort?: string
  page?: string
}

export default async function MembersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireStaffUser('member:read')
  const params = await searchParams
  const db = await getDb()

  const [result, branchRows, planRows] = await Promise.all([
    listMembers(db, {
      q: params.q,
      status: params.status,
      membershipStatus: params.membershipStatus,
      branchId: params.branchId,
      hasWaiver: params.hasWaiver === undefined ? undefined : params.hasWaiver === 'true',
      inactiveForDays: params.inactiveForDays ? Number(params.inactiveForDays) : undefined,
      sort: (params.sort as 'recent' | 'name' | 'expiring' | 'outstanding' | undefined) ?? 'recent',
      page: params.page ? Number(params.page) : 1,
      pageSize: 25,
    }),
    listBranchesForFilter(db),
    listPlansForSelect(db),
  ])

  const rows: MemberRow[] = result.rows.map((row) => ({
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    status: row.status,
    membershipStatus: row.membershipStatus,
    planName: row.planName,
    membershipEndsAt: row.membershipEndsAt ? String(row.membershipEndsAt) : null,
    lastVisitAt: row.lastVisitAt ? String(row.lastVisitAt) : null,
    visits30d: row.visits30d,
    outstandingCents: row.outstandingCents,
  }))

  const exportQuery = new URLSearchParams(
    Object.entries(params).filter(([, value]) => Boolean(value)) as [string, string][],
  ).toString()

  return (
    <>
      <PageHeader
        title="Members"
        subtitle={`${result.total} members match these filters. Search by name, email or phone.`}
        actions={
          <>
            <Link
              href={`/api/v1/reports/export?type=members${exportQuery ? `&${exportQuery}` : ''}`}
              className="rounded-xl border border-ink-700 bg-ink-800 hover:bg-ink-700 hover:text-white px-4 py-3 text-sm text-ink-200 transition-colors"
            >
              Export CSV
            </Link>
            {can(user.role as Role, 'member:write') ? (
              <a href="#new-member" className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-ink-950 hover:bg-zinc-200 transition-colors shadow-sm">
                New member
              </a>
            ) : null}
          </>
        }
      />

      <Filters
        fields={[
          { name: 'q', label: 'Search', type: 'search', placeholder: 'Name, email or phone' },
          {
            name: 'membershipStatus',
            label: 'Membership',
            type: 'select',
            options: [
              { value: 'ACTIVE', label: 'Active' },
              { value: 'FROZEN', label: 'Frozen' },
              { value: 'EXPIRED', label: 'Expired' },
              { value: 'CANCELLED', label: 'Cancelled' },
              { value: 'PENDING', label: 'Pending payment' },
            ],
          },
          {
            name: 'status',
            label: 'Account',
            type: 'select',
            options: [
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Archived' },
              { value: 'SUSPENDED', label: 'Suspended' },
            ],
          },
          {
            name: 'branchId',
            label: 'Branch',
            type: 'select',
            options: branchRows.map((branch) => ({ value: branch.id, label: branch.name })),
          },
          {
            name: 'hasWaiver',
            label: 'Waiver',
            type: 'select',
            options: [
              { value: 'true', label: 'Signed' },
              { value: 'false', label: 'Missing' },
            ],
          },
          { name: 'inactiveForDays', label: 'Inactive for (days)', type: 'search', placeholder: 'e.g. 30' },
          {
            name: 'sort',
            label: 'Sort',
            type: 'select',
            options: [
              { value: 'recent', label: 'Newest first' },
              { value: 'name', label: 'Name' },
              { value: 'expiring', label: 'Expiring soonest' },
              { value: 'outstanding', label: 'Owing most' },
            ],
          },
        ]}
      />

      <div className="mt-4 card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No members match those filters"
              hint="Try clearing the filters, or search for a partial name."
            />
          </div>
        ) : (
          <MemberTable rows={rows} />
        )}
      </div>

      {result.totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          <p className="text-ink-400">
            Page {result.page} of {result.totalPages}
          </p>
          <div className="flex gap-2">
            {result.page > 1 ? (
              <Link
                href={`/members?${new URLSearchParams({ ...params, page: String(result.page - 1) } as Record<string, string>)}`}
                className="rounded-lg border border-ink-600 px-3 py-2"
              >
                Previous
              </Link>
            ) : null}
            {result.page < result.totalPages ? (
              <Link
                href={`/members?${new URLSearchParams({ ...params, page: String(result.page + 1) } as Record<string, string>)}`}
                className="rounded-lg border border-ink-600 px-3 py-2"
              >
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}

      {can(user.role as Role, 'member:write') ? (
        <Card
          className="mt-6 scroll-mt-6"
          title="Add a member"
          description="Creates the profile, waiver record and (optionally) sells a plan in one step."
        >
          <div id="new-member" />
          <ActionForm
            endpoint="/api/v1/members"
            submitLabel="Create member"
            successMessage="Member created"
            coerce={{ takePayment: 'boolean', acceptWaiver: 'boolean' }}
            className="grid gap-4 md:grid-cols-2"
          >
            <Field label="First name" htmlFor="firstName">
              <input id="firstName" name="firstName" required className={inputClass} />
            </Field>
            <Field label="Last name" htmlFor="lastName">
              <input id="lastName" name="lastName" required className={inputClass} />
            </Field>
            <Field label="Email" htmlFor="newEmail">
              <input id="newEmail" name="email" type="email" required className={inputClass} />
            </Field>
            <Field label="Phone" htmlFor="phone" hint="Used for SMS reminders">
              <input id="phone" name="phone" className={inputClass} />
            </Field>
            <Field label="Branch" htmlFor="branchId">
              <select id="branchId" name="branchId" className={selectClass} defaultValue={user.branchId ?? ''}>
                <option value="">Unassigned</option>
                {branchRows.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Home plan" htmlFor="planId" hint="Optional: sells the plan and takes payment now">
              <select id="planId" name="planId" className={selectClass}>
                <option value="">No plan yet</option>
                {planRows.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} — {(plan.priceCents / 100).toFixed(2)} {plan.currency}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Emergency contact" htmlFor="emergencyContactName">
              <input id="emergencyContactName" name="emergencyContactName" className={inputClass} />
            </Field>
            <Field label="Emergency phone" htmlFor="emergencyContactPhone">
              <input id="emergencyContactPhone" name="emergencyContactPhone" className={inputClass} />
            </Field>
            <Field label="Health notes" htmlFor="healthNotes" hint="Visible to trainers on the class roster">
              <textarea id="healthNotes" name="healthNotes" rows={3} className={`${inputClass} h-auto py-2`} />
            </Field>
            <div className="flex flex-col gap-3 text-sm text-ink-200">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="acceptWaiver" defaultChecked />
                Waiver signed at the desk
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="takePayment" defaultChecked />
                Take payment now (offline/cash is recorded on the invoice)
              </label>
            </div>
          </ActionForm>
          <p className="mt-4 text-xs text-ink-400">
            New members get the default password <code className="rounded bg-ink-800 px-1.5 py-0.5">Passw0rd!</code> and
            should reset it in the app.
          </p>
        </Card>
      ) : null}
    </>
  )
}

async function listPlansForSelect(db: Awaited<ReturnType<typeof getDb>>) {
  const { plans } = await import('@/lib/db/schema')
  const { asc, eq } = await import('drizzle-orm')
  return db
    .select({ id: plans.id, name: plans.name, priceCents: plans.priceCents, currency: plans.currency })
    .from(plans)
    .where(eq(plans.isActive, true))
    .orderBy(asc(plans.sortOrder))
}

async function listBranchesForFilter(db: Awaited<ReturnType<typeof getDb>>) {
  const { branches } = await import('@/lib/db/schema')
  const { asc, eq } = await import('drizzle-orm')
  return db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.isActive, true))
    .orderBy(asc(branches.name))
}
