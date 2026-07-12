# Lumivex AI Public Deployment

This repo is now ready for a split public deployment:

- Vercel serves the static React frontend.
- A separate Node host runs the Lumivex AI Express backend.
- Postgres stores production auth, organization, session, vault, and audit data.
- Ollama or another internal model runtime must be reachable from the backend.

## Current Frontend

The Vercel production frontend is live at:

```text
https://astra-one-red.vercel.app
https://www.lumivexai.com
```

Set this origin on the backend:

```env
APP_ORIGIN="https://astra-one-red.vercel.app,https://lumivexai.com,https://www.lumivexai.com"
```

After the backend is deployed, set this Vercel environment variable and redeploy:

```env
VITE_API_BASE_URL="https://api.your-lumivexai-domain.com"
```

## Backend Host Requirements

Use a VPS or container host for the backend. Lumivex AI is not a good fit for Vercel serverless functions because it has long-running SSE streams, Playwright, local files, tool execution, Prisma, and an Ollama runtime boundary.

Good targets:

- VPS with Docker, such as DigitalOcean, Hetzner, AWS Lightsail, Azure VM, or Oracle Cloud.
- Container platforms that support long-running Node services and outbound model/database access.
- A single-host Docker setup with Postgres and Ollama for a private beta.

## Render Backend Path

This repo includes [render.yaml](../render.yaml) for a Render Blueprint deployment. The blueprint creates:

- `astra-backend`: Docker web service running the Express backend.
- `astra-postgres`: managed Postgres database injected as `DATABASE_URL`.
- A pre-deploy schema sync with `npm run db:push:postgres`.

Deploy steps:

1. Push this repo to GitHub.
2. In Render, choose **Blueprints** and connect the repo.
3. Review the `astra-backend` and `astra-postgres` resources.
4. Choose a model runtime:
   - Ollama/self-hosted: keep `MODEL_PROVIDER=ollama` and fill `OLLAMA_BASE_URL` with a backend-reachable Ollama URL.
   - Hosted OpenAI-compatible provider: set `MODEL_PROVIDER=openai-compatible`, `MODEL_API_BASE_URL`, `MODEL_API_KEY`, and `MODEL_NAME`.
5. Deploy the Blueprint.
6. Open the backend URL and verify `/api/backend/status`.

The Blueprint runs auth email delivery in SMTP mode for public clients. Add a real mail provider before inviting users; otherwise signup verification and password reset code delivery will fail closed instead of exposing debug codes in the browser.

Required Render environment values for auth email:

```env
AUTH_CHALLENGE_DELIVERY="smtp"
AUTH_SMTP_HOST="smtp.your-provider.com"
AUTH_SMTP_PORT="587"
AUTH_SMTP_SECURE="0"
AUTH_SMTP_USER="your-smtp-user"
AUTH_SMTP_PASS="your-smtp-password"
AUTH_MAIL_FROM="Lumivex AI <no-reply@lumivexai.com>"
```

After the first platform admin account exists, test delivery with `POST /api/admin/auth-delivery/test` while signed in as a platform admin.

Render hosts the API and Postgres. It does not automatically host Ollama for this service. Chat and benchmark routes need either `OLLAMA_BASE_URL` to point at a reachable Ollama runtime or hosted-provider variables (`MODEL_PROVIDER`, `MODEL_API_BASE_URL`, `MODEL_API_KEY`, `MODEL_NAME`). Auth, database, admin, backend status, and non-model routes can still be validated first.

## Required Production Variables

Start from [.env.production.example](../.env.production.example). The critical values are:

```env
NODE_ENV="production"
PORT="8787"
APP_ORIGIN="https://astra-one-red.vercel.app,https://lumivexai.com,https://www.lumivexai.com"
DATABASE_URL="postgresql://lumivex:replace-me@db.example.com:5432/lumivex?schema=public"
AUTH_COOKIE_SAME_SITE="none"
AUTH_COOKIE_SECURE="1"
CREDENTIAL_ENCRYPTION_KEY="replace-with-a-long-random-secret"
AUTH_CHALLENGE_DELIVERY="smtp"
MODEL_PROVIDER="openai-compatible"
MODEL_API_BASE_URL="https://api.openai.com/v1"
MODEL_API_KEY="replace-me"
MODEL_NAME="gpt-4o-mini"
STRIPE_SECRET_KEY="sk_live_replace-me"
STRIPE_WEBHOOK_SECRET="whsec_replace-me"
STRIPE_PRICE_STARTER="price_replace-me"
STRIPE_PRICE_PRO="price_replace-me"
STRIPE_PRICE_BUSINESS="price_replace-me"
STRIPE_APP_ORIGIN="https://lumivexai.com"
STRIPE_SUCCESS_URL="https://lumivexai.com/?billing=success"
STRIPE_CANCEL_URL="https://lumivexai.com/?billing=cancelled"
STRIPE_PORTAL_RETURN_URL="https://lumivexai.com"
OPENAI_INPUT_USD_PER_1M="0.15"
OPENAI_OUTPUT_USD_PER_1M="0.60"
BILLING_USAGE_MARKUP="4"
OLLAMA_BASE_URL="http://127.0.0.1:11434"
OLLAMA_MODEL="llama3.2"
```

Use `AUTH_COOKIE_SAME_SITE="none"` and `AUTH_COOKIE_SECURE="1"` when the frontend and backend are on different public domains. Without those settings, browser login cookies will not survive cross-origin API calls.

## Stripe Billing

Lumivex AI supports workspace billing through Stripe Checkout, the Stripe customer portal, and a local usage ledger for hosted model calls. The backend exposes:

- `GET /api/billing/status` for current plan and usage.
- `POST /api/billing/checkout` to start a subscription checkout for `starter`, `pro`, or `business`.
- `POST /api/billing/portal` to open the Stripe customer portal.
- `POST /api/billing/webhook` for Stripe subscription events.

Create three monthly recurring Stripe prices and map their price IDs into Render:

```env
STRIPE_PRICE_STARTER="price_..."
STRIPE_PRICE_PRO="price_..."
STRIPE_PRICE_BUSINESS="price_..."
```

Recommended launch pricing in the app is Starter at `$29/mo`, Pro at `$99/mo`, and Business at `$249/mo`. The current included hosted AI usage allowances are `$5`, `$25`, and `$75` per billing period, with hard limits of `$20`, `$100`, and `$300` respectively. These are usage accounting limits inside Lumivex AI; subscription charges are collected by Stripe.

Add a Stripe webhook endpoint pointed at the public backend:

```text
https://astra-backend-pujo.onrender.com/api/billing/webhook
```

Listen for these events:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
```

Set `STRIPE_WEBHOOK_SECRET` in Render from the endpoint signing secret. Do not put Stripe secret keys in Vercel; only the backend needs them.

Hosted model usage is recorded from OpenAI-compatible usage tokens when providers return token counts. The default OpenAI GPT-4o mini cost assumptions are:

```env
OPENAI_INPUT_USD_PER_1M="0.15"
OPENAI_OUTPUT_USD_PER_1M="0.60"
BILLING_USAGE_MARKUP="4"
```

The ledger stores provider cost and billable cost separately, so pricing can be changed later without losing the historical raw cost basis.

## Build And Run With Docker

Build the backend image:

```powershell
docker build -t lumivex-backend .
```

Run it with a production environment file:

```powershell
docker run --env-file .env.production -p 8787:8787 lumivex-backend
```

Health check:

```powershell
curl http://localhost:8787/api/health
```

## Database Setup

For local development you can use `prisma db push`, but production should use reviewed Postgres schema changes.

Minimum first deployment path:

```powershell
$env:DATABASE_URL = "postgresql://lumivex:replace-me@db.example.com:5432/lumivex?schema=public"
npm run db:generate:postgres
npm run db:push:postgres
```

For a shared or customer-facing database, review the SQL under [prisma/migrations/postgres](../prisma/migrations/postgres) and apply it through your database migration process instead of pushing blindly.

## Vercel Wiring

Once the backend has a public HTTPS URL:

1. Open the current Vercel project for Lumivex AI.
2. Add `VITE_API_BASE_URL` with the backend URL.
3. Redeploy production.
4. Confirm the live frontend can call:
   - `/api/auth/status`
   - `/api/health`
   - `/api/auth/register`

## Public Beta Checklist

- Use hosted Postgres with backups enabled.
- Use HTTPS for the backend.
- Configure a real SMTP provider for verification and reset emails.
- Set a stable `CREDENTIAL_ENCRYPTION_KEY` before saving production vault data.
- Verify `APP_ORIGIN` exactly matches the Vercel/custom frontend domain.
- Keep backend secrets out of Vercel frontend variables except `VITE_API_BASE_URL`.
- Create the first admin account after the production database is ready.
- Test signup, email verification, login, logout, password reset, chat, history, and health.
- Add a custom domain after the backend and frontend are both working.