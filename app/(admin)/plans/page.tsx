import Link from 'next/link'
import { getDb } from '@/lib/db/client'
import { requireStaffUser } from '@/lib/auth/current-user'
import { listBranches, listPlansWithCounts, listDiscounts } from '@/lib/services/catalog'
import { can, type Role } from '@/lib/constants'
import { ActionButton, ActionForm } from '@/components/ActionForm'
import {
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeader,
  StatCard,
  Table,
  formatDate,
  inputClass,
  money,
  selectClass,
} from '@/components/ui'

export const metadata = { title: 'Plans & pricing' }
export const dynamic = 'force-dynamic'

export default async function PlansPage() {
  const user = await requireStaffUser('plan:read')
  const db = await getDb()
  const [plansVal, discountsVal, branchRowsVal] = await Promise.allSettled([listPlansWithCounts(db), listDiscounts(db), listBranches(db)])
  const plans = plansVal.status === 'fulfilled' ? plansVal.value : []
  const discounts = discountsVal.status === 'fulfilled' ? discountsVal.value : []
  const branchRows = branchRowsVal.status === 'fulfilled' ? branchRowsVal.value : []

  const canWrite = can(user.role as Role, 'plan:write')
  const activeMembers = plans.reduce((total, plan) => total + plan.activeMembers, 0)
  const recurringRevenue = plans.reduce((total, plan) => total + plan.activeMembers * (plan.interval === 'ANNUAL' ? plan.priceCents / 12 : plan.priceCents), 0)

  return (
    <>
      <PageHeader
        title="Plans & pricing"
        subtitle="Memberships, class packs and day passes. Prices are in minor units (cents) and stored per plan."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active members on a plan" value={String(activeMembers)} tone="accent" />
        <StatCard label="Recurring value / month" value={money(Math.round(recurringRevenue))} hint="Annual plans normalised to monthly" />
        <StatCard label="Live discount codes" value={String(discounts.filter((code) => code.isActive).length)} />
      </div>

      <Card className="mt-4" title="Plans" padded={false}>
        {plans.length === 0 ? (
          <div className="p-8">
            <EmptyState title="No plans created yet" hint="Create your first membership plan using the form below." />
          </div>
        ) : (
          <Table head={['Plan', 'Type', 'Billing', 'Price', 'Credits', 'Freeze days', 'Members', '']}>
            {plans.map((plan) => (
              <tr key={plan.id} className="hover:bg-ink-800/40">
                <td className="px-4 py-3">
                  <span className="font-medium">{plan.name}</span>
                  <p className="text-xs text-ink-400">{plan.description ?? '—'}</p>
                </td>
                <td className="px-4 py-3 text-ink-300">{plan.type.replace('_', ' ').toLowerCase()}</td>
                <td className="px-4 py-3 text-ink-300">
                  {plan.interval.replace('_', ' ').toLowerCase()}
                  {plan.autoRenew ? ' · auto-renew' : ''}
                </td>
                <td className="px-4 py-3 stat-value">{money(plan.priceCents, plan.currency)}</td>
                <td className="px-4 py-3">{plan.classCredits ?? 'unlimited'}</td>
                <td className="px-4 py-3">{plan.freezeDaysPerYear}</td>
                <td className="px-4 py-3 stat-value">{plan.activeMembers}</td>
                <td className="px-4 py-3">
                  {canWrite ? (
                    <span className="flex gap-2">
                      <ActionButton
                        endpoint={`/api/v1/plans/${plan.id}`}
                        method="PATCH"
                        body={{ isActive: !plan.isActive }}
                        label={plan.isActive ? 'Hide' : 'Publish'}
                      />
                      <ActionButton
                        endpoint={`/api/v1/plans/${plan.id}`}
                        method="PATCH"
                        body={{ priceCents: plan.priceCents + 500 }}
                        label="+5.00"
                        title="Quick price bump of 5.00"
                        confirmMessage={`Raise ${plan.name} to ${money(plan.priceCents + 500)}?`}
                      />
                    </span>
                  ) : (
                    <Badge tone={plan.isActive ? 'positive' : 'neutral'}>{plan.isActive ? 'live' : 'hidden'}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Discount codes" padded={false}>
          <Table head={['Code', 'Discount', 'Valid until', 'Used', '']}>
            {discounts.map((code) => (
              <tr key={code.id}>
                <td className="px-4 py-3 font-mono text-xs">{code.code}</td>
                <td className="px-4 py-3">
                  {code.percentOff ? `${code.percentOff}%` : money(code.amountOffCents ?? 0)}
                  <p className="text-xs text-ink-400">{code.description ?? ''}</p>
                </td>
                <td className="px-4 py-3 text-ink-300">{code.validUntil ? formatDate(code.validUntil) : 'open'}</td>
                <td className="px-4 py-3 stat-value">
                  {code.redemptions}
                  {code.maxRedemptions ? `/${code.maxRedemptions}` : ''}
                </td>
                <td className="px-4 py-3">
                  {canWrite ? (
                    <ActionButton
                      endpoint={`/api/v1/discounts/${code.id}`}
                      method="PATCH"
                      body={{ isActive: !code.isActive }}
                      label={code.isActive ? 'Disable' : 'Enable'}
                    />
                  ) : (
                    <Badge tone={code.isActive ? 'positive' : 'neutral'}>{code.isActive ? 'active' : 'off'}</Badge>
                  )}
                </td>
              </tr>
            ))}
            {discounts.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-sm text-ink-400" colSpan={5}>
                  No discount codes yet.
                </td>
              </tr>
            ) : null}
          </Table>
        </Card>

        {canWrite ? (
          <div className="flex flex-col gap-4">
            <Card title="New plan">
              <ActionForm
                endpoint="/api/v1/plans"
                submitLabel="Create plan"
                successMessage="Plan created"
                coerce={{ priceCents: 'number', classCredits: 'number', freezeDaysPerYear: 'number' }}
                className="grid gap-3 md:grid-cols-2"
              >
                <Field label="Name" htmlFor="planName">
                  <input id="planName" name="name" required className={inputClass} placeholder="Off-peak Monthly" />
                </Field>
                <Field label="Price (cents)" htmlFor="priceCents">
                  <input id="priceCents" name="priceCents" type="number" min={0} required className={inputClass} placeholder="5900" />
                </Field>
                <Field label="Type" htmlFor="planType">
                  <select id="planType" name="type" className={selectClass} defaultValue="MEMBERSHIP">
                    <option value="MEMBERSHIP">Membership</option>
                    <option value="CLASS_PACK">Class pack</option>
                    <option value="DAY_PASS">Day pass</option>
                  </select>
                </Field>
                <Field label="Billing interval" htmlFor="planInterval">
                  <select id="planInterval" name="interval" className={selectClass} defaultValue="MONTHLY">
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="ANNUAL">Annual</option>
                    <option value="ONE_TIME">One-off</option>
                  </select>
                </Field>
                <Field label="Class credits" htmlFor="planCredits" hint="Leave empty for unlimited">
                  <input id="planCredits" name="classCredits" type="number" min={0} className={inputClass} />
                </Field>
                <Field label="Freeze days / year" htmlFor="planFreeze">
                  <input id="planFreeze" name="freezeDaysPerYear" type="number" min={0} defaultValue={0} className={inputClass} />
                </Field>
                <Field label="Branch" htmlFor="planBranch" hint="Leave empty for all branches">
                  <select id="planBranch" name="branchId" className={selectClass}>
                    <option value="">All branches</option>
                    {branchRows.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Description" htmlFor="planDescription">
                  <input id="planDescription" name="description" className={inputClass} placeholder="Off-peak hours only" />
                </Field>
              </ActionForm>
            </Card>

            <Card title="New discount code">
              <ActionForm
                endpoint="/api/v1/discounts"
                submitLabel="Create code"
                successMessage="Code created"
                coerce={{ percentOff: 'number', amountOffCents: 'number', maxRedemptions: 'number' }}
                className="grid gap-3 md:grid-cols-2"
              >
                <Field label="Code" htmlFor="code">
                  <input id="code" name="code" required className={inputClass} placeholder="JANUARY20" />
                </Field>
                <Field label="Percent off" htmlFor="percentOff" hint="Or a fixed amount in cents">
                  <input id="percentOff" name="percentOff" type="number" min={1} max={100} className={inputClass} />
                </Field>
                <Field label="Amount off (cents)" htmlFor="amountOffCents">
                  <input id="amountOffCents" name="amountOffCents" type="number" min={1} className={inputClass} />
                </Field>
                <Field label="Max redemptions" htmlFor="maxRedemptions">
                  <input id="maxRedemptions" name="maxRedemptions" type="number" min={1} className={inputClass} />
                </Field>
                <Field label="Valid until" htmlFor="validUntil">
                  <input id="validUntil" name="validUntil" type="date" className={inputClass} />
                </Field>
                <Field label="Description" htmlFor="discountDescription">
                  <input id="discountDescription" name="description" className={inputClass} />
                </Field>
              </ActionForm>
            </Card>
          </div>
        ) : null}
      </div>

      <p className="mt-4 text-xs text-ink-400">
        Adjusting a price affects new sales only; existing memberships keep the price they signed up at.{' '}
        <Link href="/members?membershipStatus=EXPIRED" className="text-white underline underline-offset-4 hover:text-zinc-300 transition-colors">
          Lapsed members
        </Link>{' '}
        are a good audience for a win-back code.
      </p>
    </>
  )
}
