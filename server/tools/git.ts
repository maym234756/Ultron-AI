import type { ToolDefinition, ToolHandler } from './types.js'
import { runTerminal } from './terminal.js'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

// ── git_status ────────────────────────────────────────────────────────────────

export const gitStatusDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'git_status',
    description: 'Show the working tree status of a git repository (staged, modified, untracked files).',
    parameters: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Repository directory. Defaults to current workspace.' },
      },
    },
  },
}

export const gitStatus: ToolHandler = (args) =>
  runTerminal({ command: 'git status', cwd: args.cwd })

// ── git_diff ──────────────────────────────────────────────────────────────────

export const gitDiffDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'git_diff',
    description: 'Show changes in working directory or staged changes. Optionally diff a specific file.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Specific file to diff (optional, diffs all if omitted).' },
        staged: { type: 'string', description: 'Set to "true" to show staged (cached) changes.' },
        cwd: { type: 'string', description: 'Repository directory.' },
      },
    },
  },
}

export const gitDiff: ToolHandler = (args) => {
  const staged = args.staged === 'true' ? '--cached ' : ''
  const file = args.file ? `"${args.file}"` : ''
  return runTerminal({ command: `git diff ${staged}${file}`.trim(), cwd: args.cwd })
}

// ── git_log ───────────────────────────────────────────────────────────────────

export const gitLogDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'git_log',
    description: 'Show recent git commit history with hash, author, date, and message.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'string', description: 'Number of commits to show (default 10).' },
        file: { type: 'string', description: 'Show only commits that touched this file.' },
        cwd: { type: 'string', description: 'Repository directory.' },
      },
    },
  },
}

export const gitLog: ToolHandler = (args) => {
  const n = parseInt(args.limit ?? '10', 10) || 10
  const file = args.file ? `-- "${args.file}"` : ''
  return runTerminal({ command: `git log --oneline --decorate -n ${n} ${file}`.trim(), cwd: args.cwd })
}

// ── git_commit ────────────────────────────────────────────────────────────────

export const gitCommitDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'git_commit',
    description: 'Stage all changes and create a commit with the given message. Use dry_run:"true" to preview the staged diffstat without committing.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message.' },
        add_all: { type: 'string', description: 'Set to "false" to skip git add -A (default stages everything).' },
        dry_run: { type: 'string', description: 'Set to "true" to preview staged changes (diffstat) without committing.' },
        cwd: { type: 'string', description: 'Repository directory.' },
      },
      required: ['message'],
    },
  },
}

export const gitCommit: ToolHandler = async (args) => {
  const msg = (args.message ?? '').replace(/"/g, "'")
  const cwd = args.cwd ?? process.cwd()
  if (args.dry_run === 'true') {
    // Stage first (unless skipped), then show diffstat without committing
    if (args.add_all !== 'false') await runTerminal({ command: 'git add -A', cwd })
    return runTerminal({ command: 'git diff --cached --stat', cwd })
  }
  const addStep = args.add_all === 'false' ? '' : 'git add -A ; '
  return runTerminal({ command: `${addStep}git commit -m "${msg}"`, cwd })
}

// ── git_push ──────────────────────────────────────────────────────────────────

export const gitPushDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'git_push',
    description: 'Push commits to a remote repository. Checks remote branch divergence before pushing and warns if local branch is behind.',
    parameters: {
      type: 'object',
      properties: {
        remote: { type: 'string', description: 'Remote name (default: origin).' },
        branch: { type: 'string', description: 'Branch to push (default: current branch).' },
        force: { type: 'string', description: 'Set to "true" for force push (use carefully).' },
        skip_safety: { type: 'string', description: 'Set to "true" to skip behind-remote safety check.' },
        cwd: { type: 'string', description: 'Repository directory.' },
      },
    },
  },
}

export const gitPush: ToolHandler = async (args) => {
  const remote = args.remote?.trim() || 'origin'
  const force = args.force === 'true' ? '--force-with-lease ' : ''
  const cwd = args.cwd ?? process.cwd()

  // Resolve current branch if not provided
  let branch = args.branch?.trim() || ''
  if (!branch) {
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd })
      branch = stdout.trim()
    } catch { /* ignore — git push will use default tracking */ }
  }

  // Safety check: warn if local branch is behind its upstream (unless forced or skipped)
  if (!force && args.skip_safety !== 'true' && branch) {
    try {
      // Fetch remote refs silently so we have up-to-date tracking info
      await execAsync(`git fetch ${remote} ${branch} --quiet`, { cwd, timeout: 15_000 }).catch(() => {})
      const { stdout: revList } = await execAsync(
        `git rev-list --left-right --count ${remote}/${branch}...HEAD`,
        { cwd }
      ).catch(() => ({ stdout: '' }))
      const parts = revList.trim().split(/\s+/)
      const behind = parseInt(parts[0] ?? '0', 10)
      if (behind > 0) {
        return `Safety check: local branch "${branch}" is ${behind} commit(s) behind "${remote}/${branch}".\nPull and merge first, or set force:"true" / skip_safety:"true" to override.`
      }
    } catch { /* safety check failure is non-fatal */ }
  }

  return runTerminal({ command: `git push ${force}${remote} ${branch}`.trim(), cwd })
}

// ── git_checkout ──────────────────────────────────────────────────────────────

export const gitCheckoutDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'git_checkout',
    description: 'Switch to a branch or create a new branch.',
    parameters: {
      type: 'object',
      properties: {
        branch: { type: 'string', description: 'Branch name to switch to.' },
        create: { type: 'string', description: 'Set to "true" to create the branch if it does not exist.' },
        cwd: { type: 'string', description: 'Repository directory.' },
      },
      required: ['branch'],
    },
  },
}

export const gitCheckout: ToolHandler = (args) => {
  const b = (args.branch ?? '').trim()
  const flag = args.create === 'true' ? '-b ' : ''
  return runTerminal({ command: `git checkout ${flag}${b}`, cwd: args.cwd })
}

// ── git_branch ────────────────────────────────────────────────────────────────

export const gitBranchDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'git_branch',
    description: 'List all local branches, showing which is active.',
    parameters: {
      type: 'object',
      properties: {
        all: { type: 'string', description: 'Set to "true" to include remote branches.' },
        cwd: { type: 'string', description: 'Repository directory.' },
      },
    },
  },
}

export const gitBranch: ToolHandler = (args) =>
  runTerminal({ command: `git branch ${args.all === 'true' ? '-a' : ''}`.trim(), cwd: args.cwd })

// ── git_clone ─────────────────────────────────────────────────────────────────

export const gitCloneDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'git_clone',
    description: 'Clone a remote git repository to a local directory.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Remote repository URL.' },
        dest: { type: 'string', description: 'Local directory to clone into (optional).' },
        cwd: { type: 'string', description: 'Parent directory for the clone.' },
      },
      required: ['url'],
    },
  },
}

export const gitClone: ToolHandler = (args) => {
  const url = (args.url ?? '').trim()
  const dest = args.dest?.trim() ? ` "${args.dest.trim()}"` : ''
  return runTerminal({ command: `git clone "${url}"${dest}`, cwd: args.cwd })
}

// ── git_add ───────────────────────────────────────────────────────────────────

export const gitAddDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'git_add',
    description: 'Selectively stage files or patterns for the next commit. Use "." or omit files to stage everything.',
    parameters: {
      type: 'object',
      properties: {
        files: { type: 'string', description: 'Space-separated file paths or glob patterns to stage. Defaults to "." (everything).' },
        patch: { type: 'string', description: 'Set to "true" for interactive hunk staging (-p). Not available in non-interactive mode; use selectively staged files instead.' },
        cwd: { type: 'string', description: 'Repository directory.' },
      },
    },
  },
}

export const gitAdd: ToolHandler = (args) => {
  const files = (args.files ?? '.').trim() || '.'
  // Reject unsafe patterns
  if (/[;&|`$]/.test(files)) return 'Error: files contains unsafe characters'
  return runTerminal({ command: `git add -- ${files}`, cwd: args.cwd })
}

// ── git_stash ─────────────────────────────────────────────────────────────────

export const gitStashDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'git_stash',
    description: 'Stash, pop, list, or drop git stash entries. Saves uncommitted changes and lets you restore them later.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action: push (save, default), pop (restore latest), apply (restore without dropping), list, drop, show.',
          enum: ['push', 'pop', 'apply', 'list', 'drop', 'show'],
        },
        message: { type: 'string', description: 'Description for push action.' },
        index: { type: 'string', description: 'Stash index number for drop/apply/show (default: 0).' },
        include_untracked: { type: 'string', description: 'Set to "true" to include untracked files when pushing.' },
        cwd: { type: 'string', description: 'Repository directory.' },
      },
    },
  },
}

export const gitStash: ToolHandler = async (args) => {
  const action = (args.action ?? 'push').toLowerCase()
  const cwd = args.cwd ?? process.cwd()
  const idx = parseInt(args.index ?? '0', 10) || 0

  if (action === 'push') {
    const msg = args.message ? ` push -m "${(args.message).replace(/"/g, "'")}"` : ''
    const untracked = args.include_untracked === 'true' ? ' --include-untracked' : ''
    if (msg) return runTerminal({ command: `git stash${msg}${untracked}`, cwd })
    return runTerminal({ command: `git stash${untracked}`, cwd })
  }
  if (action === 'pop') return runTerminal({ command: `git stash pop stash@{${idx}}`, cwd })
  if (action === 'apply') return runTerminal({ command: `git stash apply stash@{${idx}}`, cwd })
  if (action === 'list') return runTerminal({ command: 'git stash list', cwd })
  if (action === 'drop') return runTerminal({ command: `git stash drop stash@{${idx}}`, cwd })
  if (action === 'show') return runTerminal({ command: `git stash show -p stash@{${idx}}`, cwd })
  return `Error: unknown action "${action}". Use push, pop, apply, list, drop, or show.`
}

// ── git_merge ─────────────────────────────────────────────────────────────────

export const gitMergeDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'git_merge',
    description: 'Merge a branch into the current branch. Returns conflict diagnostics if conflicts occur.',
    parameters: {
      type: 'object',
      properties: {
        branch: { type: 'string', description: 'Branch name to merge.' },
        no_ff: { type: 'string', description: 'Set to "true" to force a merge commit even for fast-forward merges.' },
        squash: { type: 'string', description: 'Set to "true" to squash all commits into one (staged only, requires manual commit).' },
        abort: { type: 'string', description: 'Set to "true" to abort an in-progress conflicted merge.' },
        cwd: { type: 'string', description: 'Repository directory.' },
      },
    },
  },
}

export const gitMerge: ToolHandler = async (args) => {
  const cwd = args.cwd ?? process.cwd()
  if (args.abort === 'true') return runTerminal({ command: 'git merge --abort', cwd })
  const b = (args.branch ?? '').trim()
  if (!b) return 'Error: branch is required (or set abort:"true" to cancel)'
  const noFf = args.no_ff === 'true' ? ' --no-ff' : ''
  const squash = args.squash === 'true' ? ' --squash' : ''
  const result = await runTerminal({ command: `git merge${noFf}${squash} "${b}"`, cwd })
  // If conflicts detected, append a list of conflicting files
  if (/CONFLICT/.test(result)) {
    try {
      const conflicts = await runTerminal({ command: 'git diff --name-only --diff-filter=U', cwd })
      return `${result}\n\nConflicting files:\n${conflicts}\n\nFix conflicts, then: git add <files> && git commit\nOr: git_merge abort:"true" to cancel.`
    } catch { /* fall through */ }
  }
  return result
}
