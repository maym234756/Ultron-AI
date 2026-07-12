# Astra Local Assistant

Astra is a local AI assistant shell with a React chat interface, a Node/Express assistant engine, streaming Server-Sent Events, and Ollama as the model runtime.

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

Account auth now uses secure server-side sessions instead of browser-stored bearer tokens. Sign-up flows issue a verification code, and password recovery issues a reset code. By default Astra stays in debug delivery mode locally and surfaces those codes in the UI. If you run the included local Mailpit service and configure `.env`, Astra sends real auth emails to a local inbox instead.

Mutating and action-capable API routes require a signed-in session on the server side. This includes agent/tool streams, project and reference builders, previews, self-upgrade, memories, tasks, chat history, local code execution, and connector setup. The UI sends the session cookie to those endpoints in both local dev and packaged builds.

## Desktop App

Astra can be packaged as a Windows desktop app with Electron. The desktop app starts the bundled local server, opens the Astra window, and keeps a tray icon with the `Ctrl+Shift+U` show/hide shortcut.

Local desktop build:

```powershell
npm ci
npm run desktop:dist
```

The Windows installer is written to `desktop-release/Astra-Setup-<version>.exe`.

Overlay workflow:

- `Ctrl+Shift+U` shows or hides Astra from the tray.
- `Ctrl+Shift+Space` toggles compact overlay mode. In overlay mode Astra stays on top near the bottom of the screen, so you can type prompts while keeping File Explorer, PowerShell, a browser, or another app visible underneath.
- Astra uses a reuse-first workflow for external surfaces: if File Explorer, PowerShell, CMD, Gmail, Salesforce, or another browser tab/window is already open, follow-up actions should focus or navigate that existing surface before opening a duplicate.
- Browser automation includes a target-discovery step for complex pages: `browser_find_targets` can list buttons, links, search boxes, inputs, selectors, and labels before Astra clicks or types.

GitHub downloads are produced by `.github/workflows/desktop-release.yml`:

- Run the **Desktop Release** workflow manually to create a downloadable installer artifact.
- Push a tag like `v0.1.0` to create a public GitHub Release with the installer attached.

Users still need Ollama installed and running locally, with at least one model pulled, because Astra stays fully local and does not call cloud model APIs.

## Mobile and iPad

Astra also ships as an installable web app shell for tablet and mobile browsers. The Vite build includes a web app manifest, iOS home-screen metadata, and a service worker that caches only the app shell and static assets. API traffic is never cached by the service worker, so auth, chat, memory, and tool responses stay live.

For iPad or mobile use, host the built app behind HTTPS and open the Astra URL in Safari or a compatible browser, then add it to the home screen. The mobile surface connects to the same secured backend and still requires the user-controlled Ollama/runtime environment behind it.

The PWA shell also includes a consent-first **Run Tracker** panel. It uses browser geolocation only after the user presses Start, stores captured points in that browser, summarizes distance/time/speed/pace, and exports GPX for the user to keep or import elsewhere.

## Public Capability Upgrades

Astra's tool surface now includes 166 registered tools. Recent backend/tool additions focus on public usability, richer media work, faster engineering loops, and better browser diagnostics:

- Media and document tools: `scan_media_file`, `view_media`, `scan_pdf_document`, `generate_photo`, `extract_video_frames`, and `generate_ai_video_storyboard`.
- Video generation path: Astra can generate AI scene stills and stitch them into an MP4 storyboard with ffmpeg. This is a real generated video artifact, but not a full native text-to-video diffusion model yet.
- Playwright upgrades: `browser_performance_audit` audits page timing, resources, DOM weight, images, forms, buttons, and public UX signals; `browser_smart_extract` extracts structured page content for research, scraping, testing, and reference-building.
- Coding engine upgrades: `code_impact_search` finds symbols/features/errors with local context, while `code_quality_audit` summarizes scripts, source footprint, largest files, TODO markers, and optional TypeScript checks.
- Engine lab upgrades: `/api/engine/search` indexes tools, connectors, routes, templates, and system capabilities for discovery; `/api/engine/benchmark` runs an authenticated short Ollama response benchmark for latency and tokens/sec.
- Viewer workflow: photos, videos, audio files, and PDFs can be opened in the default local viewer from the tool layer.

## Configuration

Copy `.env.example` to `.env` or set environment variables in your shell:

```powershell
$env:PORT = "8787"
$env:MODEL_PROVIDER = "ollama"
$env:MODEL_NAME = "llama3.2"
$env:OLLAMA_BASE_URL = "http://127.0.0.1:11434"
$env:OLLAMA_MODEL = "llama3.2"
$env:DATABASE_URL = "file:./astra.db"
npm run dev
```

For a deployed multi-user environment, point `DATABASE_URL` at Postgres instead:

```powershell
$env:DATABASE_URL = "postgresql://astra:change-me@db.example.com:5432/astra?schema=public"
npm run db:push:postgres
npm run build
```

For public deployment, keep the Vercel frontend and Astra backend split. Vercel serves the static app, while a VPS/container host should run the Express backend with Postgres, SMTP, secure cookies, and access to the model runtime. This repo includes [render.yaml](render.yaml) for a Render backend plus managed Postgres Blueprint. See [docs/deployment.md](docs/deployment.md) and [.env.production.example](.env.production.example) for the production checklist.

For public chat without hosting your own GPU server, point Astra at an OpenAI-compatible provider:

```powershell
$env:MODEL_PROVIDER = "openai-compatible"
$env:MODEL_API_BASE_URL = "https://api.openai.com/v1"
$env:MODEL_API_KEY = "replace-me"
$env:MODEL_NAME = "gpt-4o-mini"
```

To send real auth emails instead of UI-visible debug codes, also configure SMTP:

```powershell
$env:AUTH_CHALLENGE_DELIVERY = "smtp"
$env:AUTH_SMTP_HOST = "127.0.0.1"
$env:AUTH_SMTP_PORT = "1025"
$env:AUTH_SMTP_SECURE = "0"
$env:AUTH_MAIL_FROM = "Astra <no-reply@astra.local>"
```

## Self-Hosted Postgres

Astra now includes a self-hosted Postgres stack for local or single-host deployments, plus a local Mailpit inbox for auth emails.

Start it with Docker Compose:

```powershell
npm run db:postgres:up
```

Then point Astra at it:

```powershell
$env:DATABASE_URL = "postgresql://astra:astra_dev_password@localhost:5432/astra?schema=public"
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

Versioned SQL migrations live in `prisma/migrations/` with separate SQLite and Postgres files. Use `db push` for disposable local development only; for shared or deployed databases, review and apply the provider-specific SQL migration.

## Local Identity Vault

Astra includes a Prisma-backed identity vault. Local desktop installs default to SQLite, while deployed environments can use Postgres behind the same auth flow. You can create Astra accounts, verify them, sign in with email or username, recover passwords, and use the **Vault** panel to store usernames, emails, passwords, tokens, and notes for external apps/connectors.

- Passwords for the Astra login are hashed with Node `scrypt`.
- Credential secrets and notes are encrypted with AES-256-GCM using `CREDENTIAL_ENCRYPTION_KEY` when configured, or a machine-specific fallback for local-only installs.
- Auth verification and reset codes can be delivered by SMTP when `AUTH_CHALLENGE_DELIVERY` resolves to email mode; otherwise Astra stays in debug delivery mode for local testing.
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
- `npm run test:astra` runs deterministic Astra routing, endpoint-guard, engine-lab, and PWA safety checks.

## Engine

The backend exposes:

- `GET /api/health` to check Ollama connectivity and local model inventory.
- `GET /api/models` to list installed Ollama models.
- `POST /api/chat` to stream assistant tokens from Ollama to the browser.

The current engine includes prompt construction, model selection, temperature control, context trimming, SSE streaming, capability search, response benchmarking, and production static serving. Good next upgrades are deeper benchmark history, per-model recommendations, local document retrieval, and enterprise deployment hardening.
