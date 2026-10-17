# 02 · Scope

## MVP — the smallest thing a gym can run a full day on

| Area | In the MVP | Explicitly out |
| --- | --- | --- |
| Auth & roles | Email/phone sign-up, email verification, password reset, revocable sessions, 5 roles with a permission matrix, member profile, waiver, emergency contact, health notes | SSO, social login, 2FA (phase 2), biometric login |
| Membership | Monthly/quarterly/annual/class-pack/day-pass plans, discount codes, purchase, renewal, freeze/unfreeze with allowance, plan change with proration, cancel at period end or immediately | Member-initiated freezes, corporate/family plans, pause-while-travelling self-service |
| Payments | Stripe Payment Intents behind a provider port, mock provider for local/demo, invoices with sequential numbers, partial and full refunds, failed-payment retries, cash/terminal settlement at the desk | Stored cards in our DB, ACH/direct debit, instalments, dunning emails with custom cadence |
| Scheduling | Recurring templates with clash detection, one-off sessions, per-class capacity/credit cost/cancellation window/penalty, cancellation with release-and-notify | Multi-room resource constraints beyond rooms, trainer availability calendars, instructor substitution workflow |
| Booking | Capacity control in a transaction, waitlist with positions, automatic promotion, credit accounting, late-cancel penalties, no-show sweep | Priority booking tiers, paid-only classes, friend booking |
| Attendance | Rotating signed QR pass, manual desk check-in, name/email/phone lookup, override with reason, per-visit log with method, class attendance | Door hardware, NFC readers, fingerprint/face check-in, offline queue |
| Reporting | Revenue, signups, attendance, peak hours, class utilisation, trainer performance, retention cohorts, plan mix, outstanding payments, CSV export, branch + date filters | PDF layout engine (print to PDF from the browser), scheduled email reports, custom report builder |
| Admin | Member CRUD/search/filters/bulk/notes, staff & roles, plans & pricing, class management, payments/refunds, announcements, audit log, settings | Payroll processing, per-branch white labelling, feature flags UI |
| Mobile | Onboarding, sign-in, membership card, QR pass, class browse/book/cancel, waitlist state, visit + payment history, notifications, profile & privacy, trainer day view with roster check-in | Offline mode, Apple/Google Wallet passes, in-app purchase for memberships (Apple 3.1.1 avoidance: we bill outside the app), social features |

## Phase 2 (next 6 months)

1. **SMS campaigns + segmentation** — Twilio is already wired; add audience filters (lapsed 30/60/90 days, plan, branch).
2. **Self-serve freeze & plan change** — needs policy guardrails (limits, fees) before it is safe without staff.
3. **Door hardware** — turnstile/reader webhook with a signed local allowlist and an offline cache.
4. **Family & corporate memberships** — payer entity, N members, shared invoice, per-member caps.
5. **Retail POS** — products, stock, till sessions, and a daily Z report.
6. **Offline-tolerant check-in** — service-worker + local allowlist so a Wi-Fi outage never stops the desk.
7. **Multi-currency & tax by region** — invoice-level tax rules, VAT/GST reporting.
8. **Wallet passes** — Apple/Google Wallet QR that auto-refreshes, so members rarely open the app.

## Phase 3 (a year out)

Payroll provider integration, franchise hierarchy with consolidated reporting, class
recommendations from attendance history, churn prediction with intervention queues,
dynamic pricing, member community features, trainer marketplace.

## Assumptions (documented so they can be challenged)

1. Members own smartphones; the desk keeps a printed fallback list for week one.
2. Card payments dominate; cash is a minority case handled by staff with an offline ledger.
3. Class capacity is a fixed number per session; equipment-specific caps (bikes, racks) are out of scope.
4. Prices are tax-inclusive; a single tax rate per branch, snapshotted onto the invoice at issue time.
5. One gym owner per tenant. Multi-tenant (SaaS) would need row-level tenancy on every table — the schema keeps `branchId` scoping as the seam for that.
6. Timezones: timestamps are stored in UTC; each branch declares an IANA timezone for display and for the local-time conversions the scheduler uses.
7. Trainer hours = scheduled class time + 15 minutes per class of setup (documented, not hidden).
8. Retention is measured as "visited in the last 30 days" — cheap to compute, good enough to trend.

## Risks and mitigations

| # | Risk | Impact | Mitigation in the code / plan |
| --- | --- | --- | --- |
| 1 | **Payment state drift** (webhook lost, double charge) | Wrong money, angry member | Idempotency keys on intents and refunds, transition guards in `markPaymentSucceeded`/`markPaymentFailed`, webhook events acknowledged and audited, retry ladder for failures, reconciliation export |
| 2 | **Booking stampede** for a 7pm class | Oversold class, refunds | Capacity re-counted inside a transaction, unique `(session_id, member_id)`, waitlist auto-promotion — tested in `tests/booking.test.ts` |
| 3 | **Late-cancel policy not enforced** (client clock or staff override) | Revenue leakage, unfairness | Server clock decides lateness; members can never waive their own penalty (checked in the router/handler); staff overrides are audited |
| 4 | **Data migration quality** | Duplicate members, broken emails | Dry-run importer with a rejects CSV, run twice against preview, forced password reset for imported accounts |
| 5 | **Store review rejection** (account deletion, privacy) | Launch delay | Account erasure and data export ship in the MVP; privacy manifest and demo credentials prepared before submission |
| 6 | **Staff adoption** | Tool gets abandoned for paper | 5-second check-in target, keyboard-first desk screen, printed fallback for week one, train-the-trainer sessions, and a "what changed" summary for staff |
| 7 | **Serverless cold starts on the dashboard** | Slow first load | Server components query Postgres directly (one hop), connection pooling via Neon, indexes on every list query |
| 8 | **Cron limits on Vercel Hobby** (daily only) | Reminders less timely | Jobs are idempotent and bounded; Pro plan or an external scheduler can call the same authenticated endpoints more often without code changes |
| 9 | **Timezone bugs in recurring classes** | Classes at the wrong hour twice a year | Sessions are materialised rows in UTC, generated with an explicit weekly rule; a DST change is a data fix, not a code fix |
| 10 | **Vendor lock-in** | Cost/exit risk | Postgres is portable (any provider), the ORM is Drizzle over plain SQL, and the API is a documented REST surface the mobile app and future clients share |

## Deliverable mapping

| Brief deliverable | Where it lives |
| --- | --- |
| 1 Discovery | [`01-discovery.md`](01-discovery.md), [`../prompt.md`](../prompt.md) §2 |
| 2 Scope | this file |
| 3 Architecture | [`03-architecture.md`](03-architecture.md) |
| 4 UX | [`04-ux.md`](04-ux.md) |
| 5 Project plan | [`05-plan.md`](05-plan.md) |
| 6 Development | `app/`, `lib/`, `components/`, `apps/mobile/`, [`../README.md`](../README.md) |
| 7 Testing | [`06-testing-uat.md`](06-testing-uat.md), `tests/` |
| 8 Launch | [`07-launch.md`](07-launch.md) |
| 9 Post-launch | [`08-operations-roadmap.md`](08-operations-roadmap.md) |
