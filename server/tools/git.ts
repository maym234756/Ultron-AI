import type { ToolDefinition, ToolHandler } from './types.js'
import { runTerminal } from './terminal.js'

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
    description: 'Stage all changes and create a commit with the given message.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message.' },
        add_all: { type: 'string', description: 'Set to "false" to skip git add -A (default stages everything).' },
        cwd: { type: 'string', description: 'Repository directory.' },
      },
      required: ['message'],
    },
  },
}

export const gitCommit: ToolHandler = (args) => {
  const msg = (args.message ?? '').replace(/"/g, "'")
  const addStep = args.add_all === 'false' ? '' : 'git add -A ; '
  return runTerminal({ command: `${addStep}git commit -m "${msg}"`, cwd: args.cwd })
}

// ── git_push ──────────────────────────────────────────────────────────────────

export const gitPushDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'git_push',
    description: 'Push commits to a remote repository.',
    parameters: {
      type: 'object',
      properties: {
        remote: { type: 'string', description: 'Remote name (default: origin).' },
        branch: { type: 'string', description: 'Branch to push (default: current branch).' },
        force: { type: 'string', description: 'Set to "true" for force push (use carefully).' },
        cwd: { type: 'string', description: 'Repository directory.' },
      },
    },
  },
}

export const gitPush: ToolHandler = (args) => {
  const remote = args.remote?.trim() || 'origin'
  const branch = args.branch?.trim() || ''
  const force = args.force === 'true' ? '--force-with-lease ' : ''
  return runTerminal({ command: `git push ${force}${remote} ${branch}`.trim(), cwd: args.cwd })
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
