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

## Configuration

Copy `.env.example` to `.env` or set environment variables in your shell:

```powershell
$env:PORT = "8787"
$env:OLLAMA_BASE_URL = "http://127.0.0.1:11434"
$env:OLLAMA_MODEL = "llama3.2"
npm run dev
```

## Scripts

- `npm run dev` starts the API and web app together.
- `npm run build` type-checks and builds both frontend and backend.
- `npm run start` runs the production server from `dist-server` and serves the built frontend from `dist`.
- `npm run lint` runs Oxlint.

## Engine

The backend exposes:

- `GET /api/health` to check Ollama connectivity and local model inventory.
- `GET /api/models` to list installed Ollama models.
- `POST /api/chat` to stream assistant tokens from Ollama to the browser.

The current engine includes prompt construction, model selection, temperature control, context trimming, SSE streaming, and production static serving. Good next upgrades are local document retrieval, persistent conversation memory, tool execution with approvals, model benchmarking, and auth/rate limits.
