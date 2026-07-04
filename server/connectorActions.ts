import { CONNECTOR_REGISTRY, getConnectorStatusSnapshot } from './connectors.js'
import { getConnectorSetupState } from './connectorSetup.js'

export type ConnectorActionMode = 'read' | 'draft' | 'write' | 'send' | 'financial'

export type ConnectorActionSchema = {
  connectorId: string
  actionId: string
  name: string
  label: string
  description: string
  mode: ConnectorActionMode
  approvalRequired: boolean
  dryRunAvailable: boolean
  inputSchema: {
    required: string[]
    properties: Record<string, { type: 'string' | 'number' | 'boolean' | 'array' | 'object'; description: string }>
  }
}

export type ConnectorActionPlan = {
  ok: boolean
  dryRun: true
  action: ConnectorActionSchema
  approvalRequired: boolean
  approvalReason: string
  permissionLevel: string
  readiness: 'api-ready' | 'browser-ready' | 'setup-needed'
  input: Record<string, unknown>
  missingInputs: string[]
  prerequisites: string[]
  planSteps: string[]
  warnings: string[]
  createdAt: number
}

const ACTIONS: ConnectorActionSchema[] = [
  {
    connectorId: 'salesforce',
    actionId: 'searchLeads',
    name: 'salesforce.searchLeads',
    label: 'Search leads',
    description: 'Find Salesforce leads by name, email, company, status, or owner.',
    mode: 'read',
    approvalRequired: false,
    dryRunAvailable: true,
    inputSchema: {
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Lead search text, email, company, or owner.' },
        limit: { type: 'number', description: 'Maximum records to inspect.' },
      },
    },
  },
  {
    connectorId: 'salesforce',
    actionId: 'logActivity',
    name: 'salesforce.logActivity',
    label: 'Log activity',
    description: 'Draft a Salesforce task/activity against a lead, contact, or account.',
    mode: 'write',
    approvalRequired: true,
    dryRunAvailable: true,
    inputSchema: {
      required: ['recordId', 'summary'],
      properties: {
        recordId: { type: 'string', description: 'Target Salesforce record id.' },
        summary: { type: 'string', description: 'Activity summary to log.' },
        dueDate: { type: 'string', description: 'Optional due date in YYYY-MM-DD format.' },
      },
    },
  },
  {
    connectorId: 'gmail',
    actionId: 'summarizeThread',
    name: 'gmail.summarizeThread',
    label: 'Summarize thread',
    description: 'Read a Gmail thread and summarize key asks, commitments, and dates.',
    mode: 'read',
    approvalRequired: false,
    dryRunAvailable: true,
    inputSchema: {
      required: ['threadQuery'],
      properties: {
        threadQuery: { type: 'string', description: 'Gmail search query or thread identifier.' },
      },
    },
  },
  {
    connectorId: 'gmail',
    actionId: 'draftReply',
    name: 'gmail.draftReply',
    label: 'Draft reply',
    description: 'Draft a reply to a Gmail thread without sending it.',
    mode: 'draft',
    approvalRequired: true,
    dryRunAvailable: true,
    inputSchema: {
      required: ['threadQuery', 'intent'],
      properties: {
        threadQuery: { type: 'string', description: 'Gmail search query or thread identifier.' },
        intent: { type: 'string', description: 'What the reply should accomplish.' },
      },
    },
  },
  {
    connectorId: 'google-sheets',
    actionId: 'appendRow',
    name: 'sheets.appendRow',
    label: 'Append row',
    description: 'Draft a row append operation for a Google Sheet.',
    mode: 'write',
    approvalRequired: true,
    dryRunAvailable: true,
    inputSchema: {
      required: ['spreadsheetId', 'sheetName', 'values'],
      properties: {
        spreadsheetId: { type: 'string', description: 'Target spreadsheet id.' },
        sheetName: { type: 'string', description: 'Target sheet/tab name.' },
        values: { type: 'array', description: 'Ordered row values to append.' },
      },
    },
  },
  {
    connectorId: 'github',
    actionId: 'reviewPullRequest',
    name: 'github.reviewPullRequest',
    label: 'Review pull request',
    description: 'Inspect a GitHub pull request and produce a review summary.',
    mode: 'read',
    approvalRequired: false,
    dryRunAvailable: true,
    inputSchema: {
      required: ['repo', 'pullNumber'],
      properties: {
        repo: { type: 'string', description: 'Repository in owner/name format.' },
        pullNumber: { type: 'number', description: 'Pull request number.' },
      },
    },
  },
  {
    connectorId: 'stripe',
    actionId: 'summarizePayments',
    name: 'stripe.summarizePayments',
    label: 'Summarize payments',
    description: 'Summarize Stripe payments over a period without changing billing data.',
    mode: 'financial',
    approvalRequired: true,
    dryRunAvailable: true,
    inputSchema: {
      required: ['dateRange'],
      properties: {
        dateRange: { type: 'string', description: 'Date range such as last 7 days or 2025-01.' },
        customerId: { type: 'string', description: 'Optional Stripe customer id.' },
      },
    },
  },
]

export function getConnectorActionSchemas(): ConnectorActionSchema[] {
  const connectorIds = new Set(CONNECTOR_REGISTRY.map(connector => connector.id))
  return ACTIONS.filter(action => connectorIds.has(action.connectorId))
}

export function findConnectorAction(actionName: string): ConnectorActionSchema | null {
  const normalized = actionName.trim().toLowerCase()
  return ACTIONS.find(action => action.name.toLowerCase() === normalized || `${action.connectorId}.${action.actionId}`.toLowerCase() === normalized) ?? null
}

export function planConnectorAction(actionName: string, input: Record<string, unknown>, availableTools: string[], env: NodeJS.ProcessEnv): ConnectorActionPlan | null {
  const action = findConnectorAction(actionName)
  if (!action) return null

  const setup = getConnectorSetupState(action.connectorId)
  const status = getConnectorStatusSnapshot(availableTools, env).connectors.find(connector => connector.id === action.connectorId)
  const missingInputs = action.inputSchema.required.filter(key => input[key] === undefined || input[key] === null || input[key] === '')
  const prerequisites: string[] = []
  const warnings: string[] = []

  if (!status || status.status === 'setup-needed') prerequisites.push('Complete connector setup before execution.')
  if (setup.preferredAuth === 'api' && !setup.apiTokenConfigured && !status?.apiConfigured) prerequisites.push('Configure API credentials or switch to browser auth.')
  if (setup.preferredAuth === 'browser' && !setup.browserSessionReady && !status?.browserSupported) prerequisites.push('Mark browser session signed in after logging in.')
  if (missingInputs.length > 0) warnings.push(`Missing required input: ${missingInputs.join(', ')}.`)
  if (setup.permissionLevel === 'read-only' && action.mode !== 'read') warnings.push('Connector permission is read-only; this action can only be planned.')

  const approvalRequired = action.approvalRequired || setup.permissionLevel === 'apply-with-approval' || action.mode === 'send' || action.mode === 'write' || action.mode === 'financial'
  const approvalReason = approvalRequired
    ? `${action.name} is a ${action.mode} action and requires human approval before execution.`
    : `${action.name} is read-only and can run after setup is ready.`

  return {
    ok: missingInputs.length === 0,
    dryRun: true,
    action,
    approvalRequired,
    approvalReason,
    permissionLevel: setup.permissionLevel,
    readiness: status?.status ?? 'setup-needed',
    input,
    missingInputs,
    prerequisites,
    planSteps: [
      `Resolve connector via ${setup.preferredAuth} auth.`,
      `Validate inputs for ${action.name}.`,
      action.mode === 'read' ? 'Read matching records/messages and summarize results.' : 'Prepare the proposed change as a draft.',
      approvalRequired ? 'Request user approval before any live mutation or send.' : 'Return read-only results with source identifiers.',
    ],
    warnings,
    createdAt: Date.now(),
  }
}