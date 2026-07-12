import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { ConnectorAuthMode } from './connectors.js'

export type ConnectorPermissionLevel = 'read-only' | 'draft-changes' | 'apply-with-approval' | 'safe-auto'

export type ConnectorSetupState = {
  connectorId: string
  preferredAuth: ConnectorAuthMode
  permissionLevel: ConnectorPermissionLevel
  auditLogEnabled: boolean
  browserSessionReady: boolean
  apiTokenConfigured: boolean
  lastTestAt: number | null
  lastTestOk: boolean | null
  lastTestDetail: string
  updatedAt: number
}

export type ConnectorAuditEntry = {
  id: string
  connectorId: string
  action: 'setup_updated' | 'connection_test' | 'native_action_dry_run'
  summary: string
  approvalRequired: boolean
  at: number
}

type ConnectorSetupStore = {
  states: Record<string, ConnectorSetupState>
  auditLog: ConnectorAuditEntry[]
}

export type ConnectorSetupSnapshot = ConnectorSetupStore

export type ConnectorSetupPatch = Partial<Pick<ConnectorSetupState,
  'preferredAuth' | 'permissionLevel' | 'auditLogEnabled' | 'browserSessionReady' | 'apiTokenConfigured' | 'lastTestAt' | 'lastTestOk' | 'lastTestDetail'
>>

const setupFile = path.join(os.homedir(), '.lumivex-connectors.json')

export const DEFAULT_CONNECTOR_PERMISSION: ConnectorPermissionLevel = 'apply-with-approval'

function defaultState(connectorId: string): ConnectorSetupState {
  return {
    connectorId,
    preferredAuth: 'browser',
    permissionLevel: DEFAULT_CONNECTOR_PERMISSION,
    auditLogEnabled: true,
    browserSessionReady: false,
    apiTokenConfigured: false,
    lastTestAt: null,
    lastTestOk: null,
    lastTestDetail: 'Not tested yet.',
    updatedAt: Date.now(),
  }
}

function readStore(): ConnectorSetupStore {
  try {
    if (!fs.existsSync(setupFile)) return { states: {}, auditLog: [] }
    const parsed = JSON.parse(fs.readFileSync(setupFile, 'utf8')) as ConnectorSetupStore
    return {
      states: parsed.states && typeof parsed.states === 'object' ? parsed.states : {},
      auditLog: Array.isArray(parsed.auditLog) ? parsed.auditLog.slice(0, 200) : [],
    }
  } catch {
    return { states: {}, auditLog: [] }
  }
}

function writeStore(store: ConnectorSetupStore): void {
  fs.writeFileSync(setupFile, JSON.stringify({
    states: store.states,
    auditLog: store.auditLog.slice(0, 200),
  }, null, 2))
}

function isPermissionLevel(value: unknown): value is ConnectorPermissionLevel {
  return value === 'read-only' || value === 'draft-changes' || value === 'apply-with-approval' || value === 'safe-auto'
}

function isAuthMode(value: unknown): value is ConnectorAuthMode {
  return value === 'browser' || value === 'api' || value === 'oauth'
}

export function getConnectorSetupState(connectorId: string): ConnectorSetupState {
  const store = readStore()
  return { ...defaultState(connectorId), ...store.states[connectorId], connectorId }
}

export function getConnectorSetupSnapshot(): ConnectorSetupSnapshot {
  const store = readStore()
  return {
    states: store.states,
    auditLog: store.auditLog.slice(0, 200),
  }
}

export function updateConnectorSetup(connectorId: string, patch: ConnectorSetupPatch): ConnectorSetupState {
  const store = readStore()
  const current = { ...defaultState(connectorId), ...store.states[connectorId], connectorId }
  const next: ConnectorSetupState = {
    ...current,
    preferredAuth: isAuthMode(patch.preferredAuth) ? patch.preferredAuth : current.preferredAuth,
    permissionLevel: isPermissionLevel(patch.permissionLevel) ? patch.permissionLevel : current.permissionLevel,
    auditLogEnabled: typeof patch.auditLogEnabled === 'boolean' ? patch.auditLogEnabled : current.auditLogEnabled,
    browserSessionReady: typeof patch.browserSessionReady === 'boolean' ? patch.browserSessionReady : current.browserSessionReady,
    apiTokenConfigured: typeof patch.apiTokenConfigured === 'boolean' ? patch.apiTokenConfigured : current.apiTokenConfigured,
    lastTestAt: typeof patch.lastTestAt === 'number' || patch.lastTestAt === null ? patch.lastTestAt : current.lastTestAt,
    lastTestOk: typeof patch.lastTestOk === 'boolean' || patch.lastTestOk === null ? patch.lastTestOk : current.lastTestOk,
    lastTestDetail: typeof patch.lastTestDetail === 'string' ? patch.lastTestDetail : current.lastTestDetail,
    updatedAt: Date.now(),
  }
  store.states[connectorId] = next
  writeStore(store)
  return next
}

export function addConnectorAuditEntry(entry: Omit<ConnectorAuditEntry, 'id' | 'at'>): ConnectorAuditEntry {
  const store = readStore()
  const next: ConnectorAuditEntry = {
    ...entry,
    id: crypto.randomUUID(),
    at: Date.now(),
  }
  store.auditLog = [next, ...store.auditLog].slice(0, 200)
  writeStore(store)
  return next
}