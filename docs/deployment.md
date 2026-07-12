# Astra Public Deployment

This repo is now ready for a split public deployment:

- Vercel serves the static React frontend.
- A separate Node host runs the Astra Express backend.
- Postgres stores production auth, organization, session, vault, and audit data.
- Ollama or another internal model runtime must be reachable from the backend.

## Current Frontend

The Vercel production frontend is live at:

```text
https://astra-one-red.vercel.app
```

Set this origin on the backend:

```env
APP_ORIGIN="https://astra-one-red.vercel.app"
```

After the backend is deployed, set this Vercel environment variable and redeploy:

```env
VITE_API_BASE_URL="https://api.your-astra-domain.com"
```

## Backend Host Requirements

Use a VPS or container host for the backend. Astra is not a good fit for Vercel serverless functions because it has long-running SSE streams, Playwright, local files, tool execution, Prisma, and an Ollama runtime boundary.

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
4. Fill `OLLAMA_BASE_URL` with a backend-reachable model runtime URL.
5. Deploy the Blueprint.
6. Open the backend URL and verify `/api/health`.

The Blueprint starts auth email delivery in debug mode so the first deployment can be tested without SMTP. Before a public beta, change `AUTH_CHALLENGE_DELIVERY` to `smtp` and add the SMTP variables from [.env.production.example](../.env.production.example).

Render hosts the API and Postgres. It does not automatically host Ollama for this service. Chat and benchmark routes need `OLLAMA_BASE_URL` to point at a reachable Ollama/model runtime; auth, database, admin, and health routes can still be validated first.

## Required Production Variables

Start from [.env.production.example](../.env.production.example). The critical values are:

```env
NODE_ENV="production"
PORT="8787"
APP_ORIGIN="https://astra-one-red.vercel.app"
DATABASE_URL="postgresql://astra:replace-me@db.example.com:5432/astra?schema=public"
AUTH_COOKIE_SAME_SITE="none"
AUTH_COOKIE_SECURE="1"
CREDENTIAL_ENCRYPTION_KEY="replace-with-a-long-random-secret"
AUTH_CHALLENGE_DELIVERY="smtp"
OLLAMA_BASE_URL="http://127.0.0.1:11434"
OLLAMA_MODEL="llama3.2"
```

Use `AUTH_COOKIE_SAME_SITE="none"` and `AUTH_COOKIE_SECURE="1"` when the frontend and backend are on different public domains. Without those settings, browser login cookies will not survive cross-origin API calls.

## Build And Run With Docker

Build the backend image:

```powershell
docker build -t astra-backend .
```

Run it with a production environment file:

```powershell
docker run --env-file .env.production -p 8787:8787 astra-backend
```

Health check:

```powershell
curl http://localhost:8787/api/health
```

## Database Setup

For local development you can use `prisma db push`, but production should use reviewed Postgres schema changes.

Minimum first deployment path:

```powershell
$env:DATABASE_URL = "postgresql://astra:replace-me@db.example.com:5432/astra?schema=public"
npm run db:generate:postgres
npm run db:push:postgres
```

For a shared or customer-facing database, review the SQL under [prisma/migrations/postgres](../prisma/migrations/postgres) and apply it through your database migration process instead of pushing blindly.

## Vercel Wiring

Once the backend has a public HTTPS URL:

1. Open the Vercel project `astra`.
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