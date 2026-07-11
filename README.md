# Ultron Local Assistant

Ultron is a local AI assistant shell with a React chat interface, a Node/Express assistant engine, streaming Server-Sent Events, and Ollama as the model runtime.

This project does not train a frontier model from scratch or outperform Anthropic/OpenAI models by itself. It gives you a fully runnable local assistant engine that can use whichever Ollama model you install, with a clean place to add retrieval, tools, auth, memory, and evaluation.

## Requirements

- Node.js 20 or newer
- Ollama running locally
- At least one Ollama model pulled

## Quick Start

```powershell
ollama serve
ollama pull llama3.2
npm run dev
```

Open http://localhost:5173. The React app proxies `/api` requests to the assistant server on http://localhost:8787.

Account auth now uses secure server-side sessions instead of browser-stored bearer tokens. Sign-up flows issue a verification code, and password recovery issues a reset code. By default Ultron stays in debug delivery mode locally and surfaces those codes in the UI. If you run the included local Mailpit service and configure `.env`, Ultron sends real auth emails to a local inbox instead.

## Desktop App

Ultron can be packaged as a Windows desktop app with Electron. The desktop app starts the bundled local server, opens the Ultron window, and keeps a tray icon with the `Ctrl+Shift+U` show/hide shortcut.

Local desktop build:

```powershell
npm ci
npm run desktop:dist
```

The Windows installer is written to `desktop-release/Ultron-Setup-<version>.exe`.

Overlay workflow:

- `Ctrl+Shift+U` shows or hides Ultron from the tray.
- `Ctrl+Shift+Space` toggles compact overlay mode. In overlay mode Ultron stays on top near the bottom of the screen, so you can type prompts while keeping File Explorer, PowerShell, a browser, or another app visible underneath.
- Ultron uses a reuse-first workflow for external surfaces: if File Explorer, PowerShell, CMD, Gmail, Salesforce, or another browser tab/window is already open, follow-up actions should focus or navigate that existing surface before opening a duplicate.
- Browser automation includes a target-discovery step for complex pages: `browser_find_targets` can list buttons, links, search boxes, inputs, selectors, and labels before Ultron clicks or types.

GitHub downloads are produced by `.github/workflows/desktop-release.yml`:

- Run the **Desktop Release** workflow manually to create a downloadable installer artifact.
- Push a tag like `v0.1.0` to create a public GitHub Release with the installer attached.

Users still need Ollama installed and running locally, with at least one model pulled, because Ultron stays fully local and does not call cloud model APIs.

## Configuration

Copy `.env.example` to `.env` or set environment variables in your shell:

```powershell
$env:PORT = "8787"
$env:OLLAMA_BASE_URL = "http://127.0.0.1:11434"
$env:OLLAMA_MODEL = "llama3.2"
$env:DATABASE_URL = "file:./ultron.db"
npm run dev
```

For a deployed multi-user environment, point `DATABASE_URL` at Postgres instead:

```powershell
$env:DATABASE_URL = "postgresql://ultron:change-me@db.example.com:5432/ultron?schema=public"
npm run db:push:postgres
npm run build
```

To send real auth emails instead of UI-visible debug codes, also configure SMTP:

```powershell
$env:AUTH_CHALLENGE_DELIVERY = "smtp"
$env:AUTH_SMTP_HOST = "127.0.0.1"
$env:AUTH_SMTP_PORT = "1025"
$env:AUTH_SMTP_SECURE = "0"
$env:AUTH_MAIL_FROM = "Ultron <no-reply@ultron.local>"
```

## Self-Hosted Postgres

Ultron now includes a self-hosted Postgres stack for local or single-host deployments, plus a local Mailpit inbox for auth emails.

Start it with Docker Compose:

```powershell
npm run db:postgres:up
```

Then point Ultron at it:

```powershell
$env:DATABASE_URL = "postgresql://ultron:ultron_dev_password@localhost:5432/ultron?schema=public"
npm run db:push:postgres
npm run dev
```

Useful commands:

- `npm run db:postgres:logs` tails the Postgres container logs.
- `npm run db:mail:logs` tails the Mailpit SMTP/inbox logs.
- `npm run db:postgres:down` stops the Postgres stack.
- `npm run db:postgres:reset` removes the Postgres volume and starts fresh on the next `up`.
- Adminer is exposed on `http://localhost:8088` by default for database inspection.
- Mailpit is exposed on `http://localhost:8025` by default for local verification and reset emails.

## Local Identity Vault

Ultron includes a Prisma-backed identity vault. Local desktop installs default to SQLite, while deployed environments can use Postgres behind the same auth flow. You can create Ultron accounts, verify them, sign in with email or username, recover passwords, and use the **Vault** panel to store usernames, emails, passwords, tokens, and notes for external apps/connectors.

- Passwords for the Ultron login are hashed with Node `scrypt`.
- Credential secrets and notes are encrypted with AES-256-GCM using `CREDENTIAL_ENCRYPTION_KEY` when configured, or a machine-specific fallback for local-only installs.
- Auth verification and reset codes can be delivered by SMTP when `AUTH_CHALLENGE_DELIVERY` resolves to email mode; otherwise Ultron stays in debug delivery mode for local testing.
- Local SQLite runtime data is ignored by Git.
- Use `npm run db:studio` for the local SQLite store or `npm run db:studio:postgres` for a Postgres deployment; Prisma Studio is an admin/debug surface, not the end-user login UI.

## Scripts

- `npm run dev` starts the API and web app together.
- `npm run build` type-checks and builds both frontend and backend.
- `npm run db:generate` regenerates both SQLite and Postgres Prisma clients.
- `npm run db:push` syncs the Prisma schema into the local SQLite database.
- `npm run db:push:postgres` syncs the Postgres schema for deployed environments.
- `npm run db:studio` opens Prisma Studio for the local SQLite database.
- `npm run db:studio:postgres` opens Prisma Studio for the Postgres database in `DATABASE_URL`.
- `npm run db:postgres:up` starts the self-hosted Postgres + Adminer stack.
- `npm run db:postgres:down` stops the self-hosted Postgres stack.
- `npm run db:postgres:reset` destroys the self-hosted Postgres volume.
- `npm run start` runs the production server from `dist-server` and serves the built frontend from `dist`.
- `npm run lint` runs Oxlint.

## Engine

The backend exposes:

- `GET /api/health` to check Ollama connectivity and local model inventory.
- `GET /api/models` to list installed Ollama models.
- `POST /api/chat` to stream assistant tokens from Ollama to the browser.

The current engine includes prompt construction, model selection, temperature control, context trimming, SSE streaming, and production static serving. Good next upgrades are local document retrieval, persistent conversation memory, tool execution with approvals, model benchmarking, and auth/rate limits.
