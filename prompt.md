# Gym Management System — Master Build Brief

> This file is the single source of truth for the project: what we are building, the
> decisions already made, the questions that still need a human answer, and how to run
> everything. Keep it updated as decisions land.

**Status:** MVP in progress · **Repo layout:** pnpm monorepo (`apps/api`, `apps/web`, `apps/mobile`) · **Last updated:** 2026-10-17

---

## 1. Product summary

One platform that replaces paper sign-in sheets, spreadsheets, and a patchwork of
front-desk tools for independent gyms and small fitness chains.

| Surface | Users | Jobs to be done |
| --- | --- | --- |
| **Mobile app** (iOS/Android) | Members, Trainers | Join/renew, book and cancel classes, QR check-in, see visits, payments, push reminders, run today's class |
| **Web admin** | Owner, Manager, Front desk | Run daily operations: members, plans, schedule, check-ins, payments, refunds, reports, staff, announcements, audit |
| **API** | both, plus future integrations | Single REST contract, RBAC, audit trail, webhooks |

**Success criteria (from the brief):** staff run a full day without paper or spreadsheets;
members book, pay, and check in from their phone.

**Product principles**

1. **Front desk speed first.** Check-in and member lookup must work in under 5 seconds, keyboard-first, offline-tolerant on flaky gym Wi-Fi.
2. **Money is never ambiguous.** Every charge, refund, and credit is an immutable ledger row. No "editing" a payment — you reverse it.
3. **One source of truth per fact.** Capacity lives on the session; entitlement lives on the membership; the booking only references them.
4. **Boring, boring, boring.** A gym at 6am cannot debug a clever architecture. Modular monolith, one database, explicit transactions.
5. **Accessible by default.** WCAG 2.1 AA, 44px touch targets, contrast-checked tokens, full keyboard navigation on web.

---

## 2. Discovery questions (10)

Each question has the **default we are building against** so work could start immediately.
Change a default and the affected parts of the plan get re-scoped.

| # | Question | Default chosen for the MVP | Impact if different |
| --- | --- | --- | --- |
| 1 | How many members today, and how many in 12 months? | 1,500 today → 10,000. Indexed queries, pagination everywhere, no full-table scans in list endpoints. | Above ~50k members we add read replicas + materialized report tables. |
| 2 | How many branches / locations? | 3 branches, multi-branch from day one (every entity is branch-scoped, staff can be assigned to one). | Single location would let us drop `branchId` scoping and simplify roles to 2. |
| 3 | Payments: which provider and countries? | **Stripe** (Cards + Apple/Google Pay via Payment Element, SCA-ready). Provider is behind a `PaymentProvider` port so Adyen/Razorpay can be added. | Non-Stripe market → swap the adapter only; ledger/refund logic unchanged. |
| 4 | Who handles refunds and chargebacks? | Manager role and above can refund; every refund is audited with a reason code. | Member-initiated refunds would need a request/approval workflow (phase 2). |
| 5 | Do you need door hardware integration (turnstiles, NFC readers)? | **No for MVP.** QR pass (rotating, signed, 60s TTL) is scanned by staff phones, plus manual check-in. Door hardware is phase 2 behind a webhook. | Hardware in scope → add device gateway service + offline allowlist cache. |
| 6 | Are class packs / credits needed, or memberships only? | Both: unlimited memberships **and** class packs with credits, plus one-off day passes. | Memberships only → remove `creditsRemaining` and pack enforcement. |
| 7 | Existing data to migrate? | Yes — CSV export from the current system (members, plans, active memberships, visit history). Importer + dry-run report included in launch docs. | Greenfield → skip the importer, but keep the CSV templates for bulk onboarding. |
| 8 | Tax handling? | Prices are tax-inclusive, single rate per branch, stored on the invoice at issue time. | US-style tax-exclusive pricing → add tax calculation before totals, keep invoice snapshot. |
| 9 | Do you need payroll processing, or just hours? | Just **trainer hours from the schedule + check-in**, exported as CSV for the payroll provider. | Full payroll integration → phase 3. |
| 10 | Budget / timeline for the MVP? | 12 weeks, 4 people (1 backend, 1 full-stack web, 1 mobile, 1 designer/PM part-time). | Half the team → cut member mobile trainer tools and campaigns from MVP. |

**Non-negotiables we are not asking about:** HTTPS everywhere, PCI SAQ-A (card data never
touches our servers), GDPR-style export/delete, audit log on every mutation, 99.9% uptime
target, automated tests in CI.

---

## 3. Decisions made (and why)

| Area | Decision | Why this, not the alternative |
| --- | --- | --- |
| Backend | **Next.js 16 Route Handlers + TypeScript**, modular monolith (one deployable) | The brief suggested NestJS/Django as a separate service. On Vercel a second long-running Node process is a liability: no containers, no always-on server. Route handlers under `/api/v1` give the same REST surface, one deploy, one set of env vars, and shared types with the dashboard. A `lib/api/router.ts` table documents every endpoint with its required permission. |
| ORM / DB | **Drizzle ORM + PostgreSQL** — embedded **PGlite** locally, pooled **Neon** Postgres in production | One Postgres dialect everywhere (no SQLite/Postgres drift), typed SQL, and SQL migrations that are reviewable in a pull request. Locally the app boots an embedded Postgres in `.data/pglite`, so `npm install && npm run db:setup && npm run dev` needs no Docker and no server. In production `DATABASE_URL` points at a pooled Neon instance. |
| Validation | **Zod** at the HTTP edge, single source for request/response types | One schema generates runtime validation + TypeScript types; no duplicated DTOs. |
| Auth | **JWT access (15 min) + rotating opaque refresh token (30 days, hashed in DB)** | Revocable sessions (logout-all, "signed in on 3 devices") without a Redis session store. Web transports the refresh token in an httpOnly cookie; mobile in the secure store. |
| Payments | **Stripe** behind a `PaymentProvider` interface, hosted Payment Element, webhook-driven state | Card data never hits our servers (SAQ-A). Local dev uses a mock provider so the whole purchase/refund flow is testable offline. |
| Web | **Next.js 16 App Router + Tailwind v4**, in-repo primitive components | Server components query the database directly (no HTTP hop), for fast first paint (<2s target). Primitives live in `components/ui.tsx` so we are not locked to a UI kit's upgrade cycle and the palette stays accessible. |
| Mobile | **Expo (React Native) + expo-router** | One codebase for iOS/Android, OTA updates for JS-only fixes, and EAS builds for store submission without a Mac in the loop for Android. |
| Jobs | **Vercel Cron** → `/api/cron/[job]` (expiry, reminders, payment retries, no-show sweep, delivery retry) | No worker process to babysit, no queue service to pay for. Jobs are idempotent and bounded so a daily run always finishes; when volume grows, the same handlers move to a queue without changing business logic. |
| Observability | Structured JSON logs from route handlers, `/api/health` (liveness + database check), Vercel Analytics + Sentry DSN slot, and an audit table for every mutation | 99.9% needs evidence: error rate, p95 latency of `/api/v1/*`, payment failure rate, webhook lag. |
| Hosting | **Vercel** (one project, preview + production) + **Neon Postgres** | Zero containers. Preview deployments per pull request, instant rollbacks, cron, and env vars in one place. Nothing in the code assumes a long-running process. |

---

## 4. MVP vs. later

**MVP (12 weeks)** — auth + 5 roles + RBAC, member profiles/waivers, plans + discounts,
purchase/renew/freeze/cancel, Stripe payments + invoices + refunds, recurring classes with
conflict detection, booking + waitlist auto-promotion + late-cancel penalty, QR + manual
check-in, dashboards/reports with CSV export, announcements, audit log, admin CRUD,
member mobile app, trainer mobile view, push/email notifications.

**Phase 2** — SMS campaigns, member self-serve freeze, door hardware, corporate/family
memberships, POS for retail, waitlist AI suggestions, native biometric check-in,
multi-currency, Zapier/webhooks for partners, advanced cohort retention.

**Phase 3** — payroll integration, white-label mobile apps, franchise hierarchy,
class recommendations, churn prediction, dynamic pricing.

Full detail and rationale: [`docs/02-scope.md`](docs/02-scope.md).

---

## 5. How to run

```bash
npm install
cp .env.example .env          # AUTH_SECRET is required; DATABASE_URL stays empty locally
npm run db:reset              # create the embedded database, migrate, seed the demo gym
npm run dev                   # http://localhost:3000 (dashboard + API)
npm test                      # unit + integration tests against a throwaway Postgres
cd apps/mobile && npm install && npm start   # Expo app (iOS/Android)
```

**Deploying to Vercel:** import the repo, set `DATABASE_URL` (Neon pooled connection
string), `AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`, then run `npm run db:migrate` against the
production database and deploy. Optional: `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`,
`RESEND_API_KEY`, Twilio credentials, `CRON_SECRET`. Full checklist in
[`docs/07-launch.md`](docs/07-launch.md).

Demo logins (seeded): `admin@ironhouse.test / Passw0rd!` (Admin),
`manager@ironhouse.test` (Manager), `frontdesk@ironhouse.test` (Staff),
`trainer@ironhouse.test` (Trainer), `member@ironhouse.test` (Member). Password for all:
`Passw0rd!`.

---

## 6. Definition of done (per feature)

- [ ] Zod-validated endpoint, RBAC permission, audit log on mutation
- [ ] Unit test for the rule (capacity, waitlist, freeze math, refund, proration)
- [ ] Integration test over HTTP (`app.inject`) including 401/403 paths
- [ ] UI state for loading / empty / error / forbidden, keyboard reachable
- [ ] Documented in `docs/03-architecture.md` API outline
- [ ] Flagged in `docs/07-launch.md` if it needs a runbook (payments, migrations)

## 7. Open risks (watch list)

1. **Payment state drift** — webhook lost, member charged twice. Mitigation: idempotency keys, reconciliation job, `payment.status` transition guard.
2. **Peak-hour booking stampede** — 60 people booking a 20-bike class at 7:00:00. Mitigation: conditional capacity update inside a transaction, unique `(sessionId, memberId)` constraint.
3. **No-shows after late cancel** — policy is only real if enforced. Mitigation: server-side cut-off (never trust client clock), penalty as invoice line, audit trail.
4. **Data migration quality** — duplicate members, broken emails. Mitigation: dry-run importer with a rejects CSV, run twice against staging.
5. **Store review delays** — account deletion requirement, privacy manifest. Mitigation: ship those in MVP, submit 2 weeks before launch.
6. **Staff adoption** — the killer of gym software. Mitigation: 5-second check-in target, keyboard shortcuts, train-the-trainer sessions, paper fallback sheet for week 1.
