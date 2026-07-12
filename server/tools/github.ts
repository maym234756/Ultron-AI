/**
 * GitHub REST API tools.
 * Token stored in .github-token file or GITHUB_TOKEN env var.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolDefinition, ToolHandler } from './types.js'

const TOKEN_FILE = join(process.cwd(), '.github-token')
const BASE = 'https://api.github.com'

async function getToken(): Promise<string> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try { return (await readFile(TOKEN_FILE, 'utf-8')).trim() } catch { return '' }
}

async function ghFetch(endpoint: string, opts?: RequestInit): Promise<unknown> {
  const token = await getToken()
  const res = await fetch(`${BASE}${endpoint}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers as Record<string, string> ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  })
  return res.json()
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function formatGitHubError(data: unknown): string | null {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = String((data as { message?: unknown }).message ?? 'Unknown GitHub error')
    const documentation = (data as { documentation_url?: unknown }).documentation_url
    return `Error: ${message}${documentation ? `\nDocs: ${documentation}` : ''}`
  }
  return null
}

// ── gh_auth_status ───────────────────────────────────────────────────────────

export const ghAuthStatusDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'gh_auth_status',
    description: 'Check GitHub token health, authenticated user, visible scopes, and API rate-limit status.',
    parameters: { type: 'object', properties: {} },
  },
}

export const ghAuthStatus: ToolHandler = async () => {
  const token = await getToken()
  if (!token) return 'No GitHub token configured. Use gh_set_token or set GITHUB_TOKEN.'
  try {
    const res = await fetch(`${BASE}/user`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(15_000),
    })
    const data = await res.json() as { login?: string; name?: string; message?: string }
    const remaining = res.headers.get('x-ratelimit-remaining') ?? '?'
    const limit = res.headers.get('x-ratelimit-limit') ?? '?'
    const reset = res.headers.get('x-ratelimit-reset')
    const scopes = res.headers.get('x-oauth-scopes') || '(fine-grained or unavailable)'
    if (!res.ok) return `GitHub auth failed (${res.status}): ${data.message ?? 'unknown error'}\nRate limit: ${remaining}/${limit}`
    const resetText = reset ? new Date(parseInt(reset, 10) * 1000).toISOString() : 'unknown'
    return [`Authenticated as: ${data.login ?? '(unknown)'}`, `Name: ${data.name ?? '(none)'}`, `Scopes: ${scopes}`, `Rate limit: ${remaining}/${limit}`, `Rate reset: ${resetText}`].join('\n')
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── gh_set_token ──────────────────────────────────────────────────────────────

export const ghSetTokenDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'gh_set_token',
    description: 'Save a GitHub Personal Access Token (PAT) so Astra can access private repos, create issues, etc.',
    parameters: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'GitHub PAT (starts with ghp_ or github_pat_).' },
      },
      required: ['token'],
    },
  },
}

export const ghSetToken: ToolHandler = async (args) => {
  if (!args.token) return 'Error: token required'
  await writeFile(TOKEN_FILE, args.token.trim(), 'utf-8')
  return 'GitHub token saved to .github-token'
}

// ── gh_repos ──────────────────────────────────────────────────────────────────

export const ghReposDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'gh_repos',
    description: "List your GitHub repositories.",
    parameters: {
      type: 'object',
      properties: {
        sort: { type: 'string', description: 'updated (default), created, pushed, full_name.' },
        limit: { type: 'string', description: 'Max repos (default 20).' },
        page: { type: 'string', description: 'Page number for pagination (default 1).' },
      },
    },
  },
}

type GhRepo = { full_name: string; description: string | null; language: string | null; stargazers_count: number; private: boolean; updated_at: string }

export const ghRepos: ToolHandler = async (args) => {
  try {
    const sort = args.sort ?? 'updated'
    const limit = boundedInt(args.limit, 20, 1, 100)
    const page = boundedInt(args.page, 1, 1, 1000)
    const data = await ghFetch(`/user/repos?sort=${encodeURIComponent(sort)}&per_page=${limit}&page=${page}`) as GhRepo[]
    const error = formatGitHubError(data)
    if (error) return error
    if (!Array.isArray(data)) return `Error: ${JSON.stringify(data)}`
    return data.map(r =>
      `${r.private ? '🔒' : '📦'} ${r.full_name} [${r.language ?? '?'}] ★${r.stargazers_count}\n   ${r.description ?? '(no description)'} | Updated: ${r.updated_at?.slice(0, 10)}`
    ).join('\n\n')
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── gh_issues ─────────────────────────────────────────────────────────────────

export const ghIssuesDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'gh_issues',
    description: 'List issues for a GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/repo (e.g. "octocat/Hello-World").' },
        state: { type: 'string', description: 'open (default), closed, all.' },
        limit: { type: 'string', description: 'Max results (default 10).' },
        page: { type: 'string', description: 'Page number for pagination (default 1).' },
      },
      required: ['repo'],
    },
  },
}

type GhIssue = { number: number; title: string; state: string; user?: { login: string }; created_at: string; body: string | null; pull_request?: unknown }

export const ghIssues: ToolHandler = async (args) => {
  if (!args.repo) return 'Error: repo required (owner/repo)'
  try {
    const limit = boundedInt(args.limit, 10, 1, 100)
    const page = boundedInt(args.page, 1, 1, 1000)
    const data = await ghFetch(`/repos/${args.repo}/issues?state=${args.state ?? 'open'}&per_page=${limit}&page=${page}`) as GhIssue[]
    const error = formatGitHubError(data)
    if (error) return error
    if (!Array.isArray(data)) return `Error: ${JSON.stringify(data)}`
    const issues = data.filter(i => !i.pull_request)
    return issues.length
      ? issues.map(i => `#${i.number} [${i.state}] ${i.title}\n   By: ${i.user?.login ?? '?'} | ${i.created_at.slice(0, 10)}\n   ${(i.body ?? '').slice(0, 120)}`).join('\n\n')
      : 'No issues found.'
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── gh_prs ────────────────────────────────────────────────────────────────────

export const ghPrsDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'gh_prs',
    description: 'List pull requests for a GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/repo.' },
        state: { type: 'string', description: 'open (default), closed, all.' },
        limit: { type: 'string', description: 'Max results (default 10).' },
        page: { type: 'string', description: 'Page number for pagination (default 1).' },
      },
      required: ['repo'],
    },
  },
}

type GhPr = { number: number; title: string; state: string; user?: { login: string }; created_at: string; head?: { label: string }; base?: { label: string } }

export const ghPrs: ToolHandler = async (args) => {
  if (!args.repo) return 'Error: repo required'
  try {
    const limit = boundedInt(args.limit, 10, 1, 100)
    const page = boundedInt(args.page, 1, 1, 1000)
    const data = await ghFetch(`/repos/${args.repo}/pulls?state=${args.state ?? 'open'}&per_page=${limit}&page=${page}`) as GhPr[]
    const error = formatGitHubError(data)
    if (error) return error
    if (!Array.isArray(data)) return `Error: ${JSON.stringify(data)}`
    return data.length
      ? data.map(pr => `#${pr.number} [${pr.state}] ${pr.title}\n   ${pr.head?.label ?? '?'} → ${pr.base?.label ?? '?'} | ${pr.user?.login ?? '?'} | ${pr.created_at.slice(0, 10)}`).join('\n\n')
      : 'No pull requests found.'
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── gh_create_issue ───────────────────────────────────────────────────────────

export const ghCreateIssueDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'gh_create_issue',
    description: 'Create a new GitHub issue.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/repo.' },
        title: { type: 'string', description: 'Issue title.' },
        body: { type: 'string', description: 'Issue body (Markdown supported).' },
        labels: { type: 'string', description: 'Comma-separated labels.' },
      },
      required: ['repo', 'title'],
    },
  },
}

export const ghCreateIssue: ToolHandler = async (args) => {
  if (!args.repo || !args.title) return 'Error: repo and title required'
  try {
    const payload: Record<string, unknown> = { title: args.title }
    if (args.body) payload.body = args.body
    if (args.labels) payload.labels = args.labels.split(',').map(l => l.trim())
    const data = await ghFetch(`/repos/${args.repo}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }) as { number?: number; html_url?: string; message?: string }
    const error = formatGitHubError(data)
    return error ? error : `Created issue #${data.number}: ${data.html_url}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── gh_repo_info ──────────────────────────────────────────────────────────────

export const ghRepoInfoDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'gh_repo_info',
    description: 'Get detailed info about a GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/repo.' },
      },
      required: ['repo'],
    },
  },
}

type GhRepoDetail = {
  full_name: string; description: string | null; language: string | null
  stargazers_count: number; forks_count: number; open_issues_count: number
  default_branch: string; private: boolean; topics: string[]; html_url: string
  pushed_at: string; size: number
}

export const ghRepoInfo: ToolHandler = async (args) => {
  if (!args.repo) return 'Error: repo required'
  try {
    const d = await ghFetch(`/repos/${args.repo}`) as GhRepoDetail
    const error = formatGitHubError(d)
    if (error) return error
    return [
      `Repo: ${d.full_name} (${d.private ? 'private' : 'public'})`,
      `URL: ${d.html_url}`,
      `Description: ${d.description ?? 'none'}`,
      `Language: ${d.language ?? 'unknown'} | ★${d.stargazers_count} | Forks: ${d.forks_count} | Issues: ${d.open_issues_count}`,
      `Default branch: ${d.default_branch} | Last push: ${d.pushed_at?.slice(0, 10)}`,
      `Size: ${(d.size / 1024).toFixed(1)} MB`,
      d.topics?.length ? `Topics: ${d.topics.join(', ')}` : '',
    ].filter(Boolean).join('\n')
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── gh_search ─────────────────────────────────────────────────────────────────

export const ghSearchDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'gh_search',
    description: 'Search GitHub for repositories, issues, or code.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        type: { type: 'string', description: 'repositories (default), issues, code.' },
        limit: { type: 'string', description: 'Max results (default 10).' },
        page: { type: 'string', description: 'Page number for pagination (default 1).' },
      },
      required: ['query'],
    },
  },
}

export const ghSearch: ToolHandler = async (args) => {
  if (!args.query) return 'Error: query required'
  try {
    const type = args.type === 'issues' ? 'issues' : args.type === 'code' ? 'code' : 'repositories'
    const limit = boundedInt(args.limit, 10, 1, 100)
    const page = boundedInt(args.page, 1, 1, 10)
    const data = await ghFetch(`/search/${type}?q=${encodeURIComponent(args.query)}&per_page=${limit}&page=${page}`) as {
      total_count?: number
      message?: string
      items?: Array<{ full_name?: string; name?: string; description?: string | null; html_url?: string; stargazers_count?: number; number?: number; title?: string; repository?: { full_name?: string } }>
    }
    const error = formatGitHubError(data)
    if (error) return error
    if (!data.items?.length) return 'No results found.'
    return `Total: ${data.total_count ?? '?'} results\n\n` + data.items.map((item, i) => {
      if (type === 'repositories') return `${i + 1}. ${item.full_name} ★${item.stargazers_count ?? 0}\n   ${item.description ?? ''}\n   ${item.html_url}`
      if (type === 'issues') return `${i + 1}. #${item.number} ${item.title}\n   ${item.repository?.full_name ?? ''} | ${item.html_url}`
      return `${i + 1}. ${item.name} in ${item.repository?.full_name ?? ''}\n   ${item.html_url}`
    }).join('\n\n')
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}
