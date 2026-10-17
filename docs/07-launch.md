# 07 · Vercel Launch & Deployment Runbook

This guide covers deploying the Ironhouse Gym Operations Platform to **Vercel** with **Neon Serverless PostgreSQL**.

---

## 1. Prerequisites Checklist

Before deploying, ensure you have:
- [x] A **Vercel account** ([vercel.com](https://vercel.com))
- [x] A **Neon PostgreSQL account** ([neon.tech](https://neon.tech)) or Supabase project
- [x] Access to this GitHub repository: `https://github.com/mjunaid1990/xcodesol-gym-managment.git`

---

## 2. Setting Up the Production Database (Neon)

1. Sign in to [neon.tech](https://neon.tech) and create a project (e.g., `ironhouse-prod`).
2. In the Neon dashboard, locate your **Connection Details**.
3. Toggle the connection mode to **"Pooled connection"** (this provides transaction-mode pooling via PgBouncer, optimized for serverless environments).
4. Copy the connection string. It will look like:
   ```
   postgresql://user:password@ep-cool-fog-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

---

## 3. Deploying to Vercel (Step-by-Step)

### Step 1: Import Project
1. Go to your [Vercel Dashboard](https://vercel.com/dashboard) and click **"Add New..." → "Project"**.
2. Select your repository: `xcodesol-gym-managment`.
3. Framework Preset: **Next.js** (automatically detected).
4. Root Directory: `./` (leave default).

### Step 2: Configure Environment Variables
In the Vercel **Environment Variables** section, add the following:

| Variable Name | Required | Example / Description |
| :--- | :--- | :--- |
| `DATABASE_URL` | **Yes** | Your pooled Neon Postgres connection string (`...-pooler...sslmode=require`) |
| `AUTH_SECRET` | **Yes** | Secure random key (generate via: `openssl rand -base64 48`) |
| `NEXT_PUBLIC_APP_URL` | **Yes** | Your production Vercel domain, e.g. `https://ironhouse.vercel.app` |
| `CRON_SECRET` | **Yes** | Random token to secure `/api/cron/*` endpoints |
| `STRIPE_SECRET_KEY` | Optional | Stripe secret key (`sk_live_...` or `sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Optional | Stripe webhook secret (`whsec_...`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Optional | Stripe publishable key (`pk_live_...` or `pk_test_...`) |
| `RESEND_API_KEY` | Optional | Resend API key for transactional emails |
| `EMAIL_FROM` | Optional | Sender address, e.g. `"Ironhouse Gym <noreply@yourdomain.com>"` |
| `TWILIO_ACCOUNT_SID` | Optional | Twilio SID for SMS notifications |
| `TWILIO_AUTH_TOKEN` | Optional | Twilio Auth Token |
| `TWILIO_FROM_NUMBER` | Optional | Twilio phone number |

### Step 3: Configure Build Command & Deploy
- Under **Build and Output Settings**:
  - Build Command: `npm run build`
  - Output Directory: `.next` (default)
  - Install Command: `npm install`
- Click **"Deploy"**.

---

## 4. Running Migrations & Seeding Initial Data

Once the database is connected, apply the Drizzle schema migrations to your Neon database:

### Option A: From your local machine (Recommended)
Set your Neon connection string in your local terminal and run:
```bash
# 1. Run migrations against your production database
DATABASE_URL="postgresql://user:password@ep-xxx-pooler.neon.tech/neondb?sslmode=require" npm run db:migrate

# 2. (Optional) Seed demo gym accounts and timetable
DATABASE_URL="postgresql://user:password@ep-xxx-pooler.neon.tech/neondb?sslmode=require" npm run db:seed
```

### Option B: Automated via Vercel Build Command
In Vercel Project Settings → General → Build Command, customize the build command to:
```bash
npm run db:migrate && npm run build
```
This ensures schema migrations are automatically executed before every deployment.

---

## 5. Vercel Cron Jobs

The project includes pre-configured scheduled jobs in [`vercel.json`](../vercel.json):

| Job Route | Schedule | Purpose |
| :--- | :--- | :--- |
| `/api/cron/reminders` | `0 8 * * *` (8:00 AM UTC) | Sends class reminders 2 hours before scheduled sessions |
| `/api/cron/expiry` | `0 6 * * *` (6:00 AM UTC) | Flags expiring memberships and queues renewal nudges |
| `/api/cron/retries` | `30 6 * * *` (6:30 AM UTC) | Retries failed recurring Stripe invoices on a 1/3/7-day ladder |
| `/api/cron/noshow` | `30 23 * * *` (11:30 PM UTC) | Marks un-checked-in bookings as `NO_SHOW` and enforces policy |

Vercel Cron automatically calls these endpoints with `Authorization: Bearer <CRON_SECRET>`.

---

## 6. Post-Deployment Verification (Smoke Tests)

After deployment finishes, verify the live system:

1. **Health Check Endpoint:**  
   Navigate to `https://your-domain.vercel.app/api/health`.  
   Expected response:
   ```json
   {
     "status": "healthy",
     "timestamp": "2026-10-17T23:00:00.000Z",
     "database": "connected"
   }
   ```
2. **Operations Console Login:**  
   Navigate to `https://your-domain.vercel.app/login`.  
   Sign in with an admin or staff account:
   - Email: `admin@ironhouse.test`
   - Password: `Passw0rd!`
3. **5-Second Check-in Desk:**  
   Navigate to `/checkin`, press `/` to focus the search bar, and test member lookup.
4. **Mobile App API Connection:**  
   In your Expo mobile app, set `EXPO_PUBLIC_API_URL=https://your-domain.vercel.app` to connect the mobile client to your live production Vercel backend.

---

## 7. Troubleshooting Common Issues

- **Database Connection Timeout:** Ensure your Neon connection string uses the **`-pooler`** host and includes `?sslmode=require`. Neon non-pooled connections can exhaust available slots quickly under serverless spikes.
- **Unauthorized on Cron Jobs:** Verify that `CRON_SECRET` in your Vercel Environment Variables matches what is configured in your project settings.
- **Stripe Webhook Signature Failed:** Ensure `STRIPE_WEBHOOK_SECRET` is set in Vercel and points to `https://your-domain.vercel.app/api/webhooks/stripe`.
