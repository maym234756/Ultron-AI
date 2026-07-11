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

## Local Identity Vault

Ultron includes a local Prisma + SQLite identity vault. On first launch, create a local Ultron login. After signing in, use the **Vault** panel to store usernames, emails, passwords, tokens, and notes for external apps/connectors.

- Passwords for the Ultron login are hashed with Node `scrypt`.
- Credential secrets and notes are encrypted locally with AES-256-GCM using a machine-specific key.
- The SQLite database is local-only and ignored by Git.
- Open Prisma Studio with `npm run db:studio` to inspect the local database.

## Scripts

- `npm run dev` starts the API and web app together.
- `npm run build` type-checks and builds both frontend and backend.
- `npm run db:generate` regenerates the Prisma client.
- `npm run db:push` syncs the Prisma schema into the local SQLite database.
- `npm run db:studio` opens Prisma Studio for the local Ultron database.
- `npm run start` runs the production server from `dist-server` and serves the built frontend from `dist`.
- `npm run lint` runs Oxlint.

## Engine

The backend exposes:

- `GET /api/health` to check Ollama connectivity and local model inventory.
- `GET /api/models` to list installed Ollama models.
- `POST /api/chat` to stream assistant tokens from Ollama to the browser.

The current engine includes prompt construction, model selection, temperature control, context trimming, SSE streaming, and production static serving. Good next upgrades are local document retrieval, persistent conversation memory, tool execution with approvals, model benchmarking, and auth/rate limits.
