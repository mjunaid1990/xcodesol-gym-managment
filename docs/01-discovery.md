# 01 · Discovery

## The problem in one paragraph

An independent gym with 1,500–3,000 members runs on three brittle systems: a paper sign-in
sheet (or a spreadsheet), a card terminal with no ledger, and a class timetable that lives
in a WhatsApp group. Staff cannot answer "how many visits did we have on Tuesday?" without
counting, owners discover churn after the member has already left, and members cannot see
whether they have a valid membership without asking at the desk.

**What "done" looks like:** a member books a class, pays, and walks in with a QR code on
their phone; the front desk checks people in from a phone in under five seconds; the owner
opens one screen and sees revenue, attendance, class fill and who owes money.

## Personas

| Persona | Context | Needs | Friction we remove |
| --- | --- | --- | --- |
| **Mia, 29 — Member** | Trains 3× a week after work, books on the bus | See if she has credits, book a spot, check in without a card, know when her plan ends | Queueing at the desk, "are you on the list?" arguments, being charged for a class she cancelled in time |
| **Jonah, 41 — Front desk (STAFF)** | Runs the desk at 6am with a queue out the door | Look a member up in one search, admit or refuse confidently, sell a plan, take cash | Paper sheets, remembering who paid, calling a manager for every exception |
| **Nadia, 34 — Trainer** | Teaches 4–6 classes a day across two studios | See today's roster with health notes, mark attendance, know who is on the waitlist | Printed lists that change after they are printed, no health context |
| **Priya, 38 — Manager** | Owns daily operations for one branch | Fill rate, no-shows, failed payments, staff hours, freeze/cancel exceptions | Monthly spreadsheet archaeology, chasing payment failures by memory |
| **Ava, 45 — Owner (ADMIN)** | Three branches, P&L responsibility | Revenue trend, churn, plan mix, branch comparison, audit trail | Deciding on gut feel, discovering problems in month-end reports |

## Jobs to be done

1. **When I arrive at the gym**, I want to be admitted in seconds so my workout is not delayed by admin.
2. **When I plan my week**, I want to see the real timetable and book a spot so I do not waste a trip.
3. **When a class is full**, I want a fair queue so a cancelled spot does not go to waste.
4. **When I get to the desk**, I want to know if this member may train right now and why not.
5. **When money moves**, I want a record I can trust, and a refund I can trace.
6. **When a member lapses**, I want to know before they leave, not after.
7. **When an owner asks "how are we doing?"**, I want an answer in one screen instead of a report request.

## User stories (MVP, with acceptance criteria)

### Authentication & profile
- **US-1** *As a visitor, I can sign up with email + password, verify my email, and accept the gym waiver.*
  - Password ≥ 8 chars with a letter and a number; duplicate email/phone → 409 with a readable message.
  - Registration creates the member profile and a verification token; the token is emailed (and returned in non-production for testing).
- **US-2** *As a member, I can sign in by email or phone and stay signed in for 30 days.*
  - Wrong password 8 times in 15 minutes → 429 with a "try again in 15 minutes" message.
  - Refresh tokens rotate on use; `sign out everywhere` revokes every device.
- **US-3** *As a member, I can reset my password and see my active sessions.*
  - A reset link works once, expires in 60 minutes, and revokes all sessions (a stolen session dies with the password).
- **US-4** *As a member, I can export or erase my account data (GDPR-style).*
  - Erasure anonymises the person and revokes sessions, while invoices and payments stay intact for accounting.

### Membership
- **US-5** *As a member, I can buy a plan and get an invoice.*
  - Card path: a payment intent is created; the membership activates on `payment_intent.succeeded`, not before.
  - Desk path: cash payment marks the invoice paid immediately and records `provider = cash`.
- **US-6** *As front desk, I can renew, freeze, unfreeze, upgrade or cancel a membership.*
  - Renewal stacks onto the current end date (never truncates).
  - Freeze respects the plan's yearly allowance, extends the end date by the same days, and returns unused days on early unfreeze.
  - Plan change credits unused time at `remaining days / total days × price paid` on the new invoice.
- **US-7** *As a member, I get reminders before my plan ends and a nudge when a payment fails.*
  - Daily sweep queues `MEMBERSHIP_EXPIRING` (7 days), `MEMBERSHIP_EXPIRED`, and retries failed payments on a 1/3/7-day ladder.

### Classes & bookings
- **US-8** *As a manager, I can create a recurring class and trust the timetable.*
  - Creating a template generates the next 8 weeks of sessions and skips slots that clash with the trainer or room, reporting what it skipped.
- **US-9** *As a member, I can book, join a waitlist, and cancel.*
  - Booking is refused when the membership is inactive/expired/frozen, when the class already started, or for a duplicate.
  - Full class → waitlist with a position; a cancellation promotes the first eligible waitlisted member and notifies them.
  - Cancelling inside the window (default 6h) records `lateCancel`, keeps the credit, and raises a penalty invoice when the class has a fee.
- **US-10** *As a trainer, I can see today's roster with health notes and mark attendance.*
  - Attendance can be recorded per booking (attended / no-show) or by checking the member in.
  - Anyone still `BOOKED` 30 minutes after the class ends becomes `NO_SHOW` on the nightly sweep.

### Attendance
- **US-11** *As a member, I can check in with a rotating QR pass.*
  - The pass is HMAC-signed, expires in 90 seconds, and is rejected if tampered with or expired.
  - A second scan inside 30 minutes is refused (prevents double-counting and sharing).
- **US-12** *As front desk, I can admit someone with an override and leave a trail.*
  - Overrides require a reason, are stored on the visit, and appear in the audit log with the staff user.

### Money
- **US-13** *As a manager, I can refund part or all of a payment.*
  - Refunds never edit the original row: a refund record is written, the payment becomes `PARTIALLY_REFUNDED`/`REFUNDED`, and the invoice follows.
- **US-14** *As front desk, I can settle an invoice in cash or on the terminal.*
  - Marking paid writes a payment row with `provider = cash|terminal` and closes the invoice.
- **US-15** *As an owner, I can see revenue, churn, utilisation and outstanding payments for a date range and branch.*
  - Every report accepts `from`, `to`, `branchId` and exports CSV with a UTF-8 BOM so Excel opens it cleanly.

### Admin
- **US-16** *As a manager, I can find members by name/email/phone, filter by membership state, and act in bulk.*
  - Bulk actions (note, grant credits, deactivate, suspend, reactivate) report per-member success/failure.
- **US-17** *As an owner, I can post an announcement to push/email/SMS.*
  - Fan-out is batched and per-recipient delivery state is recorded, so a failed channel never blocks the send.
- **US-18** *As an owner, I can see who changed what.*
  - Every mutation writes an audit row (actor, action, entity, before/after context, IP); the log is append-only in the UI.

## What we deliberately do not do in the MVP

Paperless-only operations, door hardware, payroll processing, family/corporate plans,
retail POS, custom branding per branch, and native offline mode. Each is scheduled in
[`02-scope.md`](02-scope.md) with the reason it can wait.
