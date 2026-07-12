import type { ToolArgs, ToolDefinition, ToolHandler } from './types.js'
import { runTerminal, terminalDefinition } from './terminal.js'
import {
  writeFile, writeFileDefinition,
  readFile, readFileDefinition,
  listDirectory, listDirectoryDefinition,
  readPdf, readPdfDefinition,
} from './filesystem.js'
import { openBrowser, openBrowserDefinition, fetchWebpage, fetchWebpageDefinition, listTabs, listTabsDefinition, focusTab, focusTabDefinition } from './browser.js'
import { searchWeb, searchWebDefinition } from './search.js'
import { memoryWrite, memoryWriteDefinition, memoryRead, memoryReadDefinition } from './memory.js'
import {
  openApp, openAppDefinition,
  takeScreenshot, screenshotDefinition,
  clipboardRead, clipboardReadDefinition,
  clipboardWrite, clipboardWriteDefinition,
  speak, speakDefinition,
  generateImage, generateImageDefinition,
  notify, notifyDefinition,
} from './system.js'
import { analyzeImage, analyzeImageDefinition, screenRead, screenReadDefinition } from './vision.js'
import {
  createSlideshow, createSlideshowDefinition,
  recordScreen, recordScreenDefinition,
  convertVideo, convertVideoDefinition,
} from './media.js'
import {
  browserGo, browserGoDefinition,
  browserClick, browserClickDefinition,
  browserFill, browserFillDefinition,
  browserRead, browserReadDefinition,
  browserAssert, browserAssertDefinition,
  browserSnapshot, browserSnapshotDefinition,
  browserFindTargets, browserFindTargetsDefinition,
  browserScreenshot, browserScreenshotDefinition,
  browserEval, browserEvalDefinition,
  browserWait, browserWaitDefinition,
  browserSelect, browserSelectDefinition,
  browserClose, browserCloseDefinition,
  browserConnectChrome, browserConnectChromeDefinition,
  browserType, browserTypeDefinition,
  browserKey, browserKeyDefinition,
  browserHover, browserHoverDefinition,
  browserScroll, browserScrollDefinition,
  browserCheck, browserCheckDefinition,
  browserGetText, browserGetTextDefinition,
  browserGetAttr, browserGetAttrDefinition,
  browserExtractTable, browserExtractTableDefinition,
  browserFindText, browserFindTextDefinition,
  browserUpload, browserUploadDefinition,
  browserDialog, browserDialogDefinition,
  browserPdf, browserPdfDefinition,
  browserReadEmails, browserReadEmailsDefinition,
  browserClickEmail, browserClickEmailDefinition,
  browserComposeReply, browserComposeReplyDefinition,
} from './playwright.js'
import {
  runCode, runCodeDefinition,
  lintCode, lintCodeDefinition,
  openInEditor, openInEditorDefinition,
  codeSearch, codeSearchDefinition,
  diffFiles, diffFilesDefinition,
  patchFile, patchFileDefinition,
  codeTodos, codeTodosDefinition,
  codeStats, codeStatsDefinition,
} from './coding.js'
import {
  gitStatus, gitStatusDefinition,
  gitDiff, gitDiffDefinition,
  gitLog, gitLogDefinition,
  gitCommit, gitCommitDefinition,
  gitPush, gitPushDefinition,
  gitCheckout, gitCheckoutDefinition,
  gitBranch, gitBranchDefinition,
  gitClone, gitCloneDefinition,
  gitAdd, gitAddDefinition,
  gitStash, gitStashDefinition,
  gitMerge, gitMergeDefinition,
} from './git.js'
import { httpRequest, httpRequestDefinition } from './http.js'
import { dbQuery, dbQueryDefinition, dbExecute, dbExecuteDefinition, dbSchema, dbSchemaDefinition, dbTransaction, dbTransactionDefinition, dbBackup, dbBackupDefinition, dbQueryPaged, dbQueryPagedDefinition } from './database.js'
import {
  browserNewTab, browserNewTabDefinition,
  browserTabs, browserTabsDefinition,
  browserSwitchTab, browserSwitchTabDefinition,
  browserUseTab, browserUseTabDefinition,
  browserCloseTab, browserCloseTabDefinition,
} from './playwright.js'
import {
  ragIndex, ragIndexDefinition,
  ragSearch, ragSearchDefinition,
  ragStatus, ragStatusDefinition,
  ragClear, ragClearDefinition,
  ragRepair, ragRepairDefinition,
} from './rag.js'
import {
  scheduleTask, scheduleTaskDefinition,
  listSchedules, listSchedulesDefinition,
  cancelSchedule, cancelScheduleDefinition,
  runScheduleNow, runScheduleNowDefinition,
} from './scheduler.js'
import { planConnectorAction } from '../connectorActions.js'
import {
  emailRead, emailReadDefinition,
  emailSend, emailSendDefinition,
  emailSearch, emailSearchDefinition,
  calendarRead, calendarReadDefinition,
  calendarCreate, calendarCreateDefinition,
  composeEmail, composeEmailDefinition,
  detectEmailProvider, detectEmailProviderDefinition,
} from './outlook.js'
import { pythonExec, pythonExecDefinition, pythonReset, pythonResetDefinition } from './python_repl.js'
import { transcribeAudio, transcribeAudioDefinition, installWhisper, installWhisperDefinition } from './whisper.js'
import { memSave, memSaveDefinition, memRecall, memRecallDefinition, memList, memListDefinition, memForget, memForgetDefinition } from './longmem.js'
import { sysStats, sysStatsDefinition, sysProcesses, sysProcessesDefinition, sysKill, sysKillDefinition, sysRun, sysRunDefinition, sysEnv, sysEnvDefinition } from './sysmon.js'
import { fileRead, fileReadDefinition, fileWrite, fileWriteDefinition, fileList, fileListDefinition, fileMove, fileMoveDefinition, fileDelete, fileDeleteDefinition, fileSearch, fileSearchDefinition, fileInfo, fileInfoDefinition, folderCreate, folderCreateDefinition, folderDelete, folderDeleteDefinition, folderCopy, folderCopyDefinition, openInExplorer, openInExplorerDefinition } from './userfiles.js'
import { ghSetToken, ghSetTokenDefinition, ghAuthStatus, ghAuthStatusDefinition, ghRepos, ghReposDefinition, ghIssues, ghIssuesDefinition, ghPrs, ghPrsDefinition, ghCreateIssue, ghCreateIssueDefinition, ghRepoInfo, ghRepoInfoDefinition, ghSearch, ghSearchDefinition, ghCreateBranch, ghCreateBranchDefinition, ghCreatePr, ghCreatePrDefinition, ghComment, ghCommentDefinition, ghLabel, ghLabelDefinition, ghAssign, ghAssignDefinition, ghClose, ghCloseDefinition, ghMergePr, ghMergePrDefinition } from './github.js'
import { desktopClick, desktopClickDefinition, desktopType, desktopTypeDefinition, desktopSendKeys, desktopSendKeysDefinition, desktopFindWindow, desktopFindWindowDefinition, desktopListWindows, desktopListWindowsDefinition, desktopGetCursorPos, desktopGetCursorPosDefinition, desktopScroll, desktopScrollDefinition } from './desktop.js'
import { agentRun, agentRunDefinition, agentParallel, agentParallelDefinition } from './multiagent.js'
import {
  webScrape, webScrapeDefinition,
  webScrapePages, webScrapePagesDefinition,
  webScrapeList, webScrapeListDefinition,
  webMonitor, webMonitorDefinition,
  webCheckMonitor, webCheckMonitorDefinition,
  webListMonitors, webListMonitorsDefinition,
} from './scraper.js'
import {
  browserVaultSave, browserVaultSaveDefinition,
  browserVaultList, browserVaultListDefinition,
  browserLogin, browserLoginDefinition,
  browserStealth, browserStealthDefinition,
  browserWatch, browserWatchDefinition,
  browserRecordStart, browserRecordStartDefinition,
  browserRecordStop, browserRecordStopDefinition,
  browserNetworkCapture, browserNetworkCaptureDefinition,
} from './playwright_adv.js'
import { ragIndexUrl, ragIndexUrlDefinition } from './rag.js'
import { previewWrite, previewWriteDefinition, previewExec, previewExecDefinition } from './preview.js'
import {
  taskAdd, taskAddDefinition,
  taskList, taskListDefinition,
  taskDone, taskDoneDefinition,
  taskDelete, taskDeleteDefinition,
  taskUpdate, taskUpdateDefinition,
  dailyBriefing, dailyBriefingDefinition,
} from './tasks.js'
// Inc 17: scheduler enable/disable
import { scheduleEnable, scheduleEnableDefinition, scheduleDisable, scheduleDisableDefinition } from './scheduler.js'
// Inc 18: agent_status
import { agentStatus, agentStatusDefinition } from './multiagent.js'
// Inc 19: repl_packages
import { replPackages, replPackagesDefinition } from './python_repl.js'
// Inc 20: workspace_tree
import { workspaceTree, workspaceTreeDefinition } from './filesystem.js'
// Inc 21: sysmon new tools
import { sysServices, sysServicesDefinition, sysPorts, sysPortsDefinition } from './sysmon.js'
// Inc 22: media new tools
import { probeMedia, probeMediaDefinition, trimVideo, trimVideoDefinition } from './media.js'
// Inc 23: analyze_screenshot
import { analyzeScreenshot, analyzeScreenshotDefinition } from './vision.js'
// Inc 24: whisper_status
import { whisperStatus, whisperStatusDefinition } from './whisper.js'
// Inc 25: mem_update, mem_search_tags
import { memUpdate, memUpdateDefinition, memSearchTags, memSearchTagsDefinition } from './longmem.js'
// Inc 26: desktop_active_window
import { desktopActiveWindow, desktopActiveWindowDefinition } from './desktop.js'
// Inc 27: cache tools
import { cacheStatus, cacheStatusDefinition, cacheGet, cacheGetDefinition, cacheSet, cacheSetDefinition, cacheClear, cacheClearDefinition } from './cache.js'
// Inc 28: git_tag, git_cherry_pick
import { gitTag, gitTagDefinition, gitCherryPick, gitCherryPickDefinition } from './git.js'
// Inc 29: curl tools
import { curlImport, curlImportDefinition, curlExport, curlExportDefinition } from './http.js'
// Inc 31: plugin management
import { pluginList, pluginListDefinition, pluginEnable, pluginEnableDefinition, pluginDisable, pluginDisableDefinition, pluginCreate, pluginCreateDefinition, pluginRead, pluginReadDefinition } from './plugins.js'
// Inc 32: webhooks
import { webhookRegister, webhookRegisterDefinition, webhookList, webhookListDefinition, webhookDelete, webhookDeleteDefinition, webhookToggle, webhookToggleDefinition } from './webhooks.js'
// Inc 33: sys_platform
import { sysPlatform, sysPlatformDefinition } from './platform.js'

const connectorActionDryRunDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'connector_action_dry_run',
    description: 'Plan a typed native connector action in dry-run mode. Never mutates live connector data.',
    parameters: {
      type: 'object',
      properties: {
        actionName: { type: 'string', description: 'Native action name, e.g. salesforce.searchLeads or gmail.draftReply.' },
        inputJson: { type: 'string', description: 'JSON object containing the action inputs.' },
      },
      required: ['actionName'],
    },
  },
}

async function connectorActionDryRun(args: ToolArgs): Promise<string> {
  let input: Record<string, unknown> = {}
  if (args.inputJson) {
    try {
      const parsed = JSON.parse(args.inputJson) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Record<string, unknown>
    } catch {
      return 'Error: inputJson must be a JSON object string.'
    }
  }

  const plan = planConnectorAction(args.actionName ?? '', input, toolDefinitions.map(tool => tool.function.name), process.env)
  if (!plan) return `Error: Unknown native connector action "${args.actionName ?? ''}".`
  return JSON.stringify(plan, null, 2)
}

export const toolDefinitions: ToolDefinition[] = [
  terminalDefinition,
  writeFileDefinition,
  readFileDefinition,
  listDirectoryDefinition,
  openBrowserDefinition,
  fetchWebpageDefinition,
  listTabsDefinition,
  focusTabDefinition,
  searchWebDefinition,
  memoryWriteDefinition,
  memoryReadDefinition,
  openAppDefinition,
  screenshotDefinition,
  clipboardReadDefinition,
  clipboardWriteDefinition,
  speakDefinition,
  generateImageDefinition,
  analyzeImageDefinition,
  screenReadDefinition,
  createSlideshowDefinition,
  recordScreenDefinition,
  convertVideoDefinition,
  browserGoDefinition,
  browserClickDefinition,
  browserFillDefinition,
  browserReadDefinition,
  browserAssertDefinition,
  browserSnapshotDefinition,
  browserFindTargetsDefinition,
  browserScreenshotDefinition,
  browserEvalDefinition,
  browserWaitDefinition,
  browserSelectDefinition,
  browserCloseDefinition,
  browserConnectChromeDefinition,
  browserTypeDefinition,
  browserKeyDefinition,
  browserHoverDefinition,
  browserScrollDefinition,
  browserCheckDefinition,
  browserGetTextDefinition,
  browserGetAttrDefinition,
  browserExtractTableDefinition,
  browserFindTextDefinition,
  browserUploadDefinition,
  browserDialogDefinition,
  browserPdfDefinition,
  browserReadEmailsDefinition,
  browserClickEmailDefinition,
  browserComposeReplyDefinition,
  runCodeDefinition,
  lintCodeDefinition,
  openInEditorDefinition,
  codeSearchDefinition,
  diffFilesDefinition,
  patchFileDefinition,
  codeTodosDefinition,
  codeStatsDefinition,
  readPdfDefinition,
  gitStatusDefinition,
  gitDiffDefinition,
  gitLogDefinition,
  gitCommitDefinition,
  gitPushDefinition,
  gitCheckoutDefinition,
  gitBranchDefinition,
  gitCloneDefinition,
  gitAddDefinition,
  gitStashDefinition,
  gitMergeDefinition,
  httpRequestDefinition,
  dbQueryDefinition,
  dbExecuteDefinition,
  dbSchemaDefinition,
  dbTransactionDefinition,
  dbBackupDefinition,
  dbQueryPagedDefinition,
  notifyDefinition,
  browserNewTabDefinition,
  browserTabsDefinition,
  browserSwitchTabDefinition,
  browserUseTabDefinition,
  browserCloseTabDefinition,
  // RAG
  ragIndexDefinition,
  ragSearchDefinition,
  ragStatusDefinition,
  ragClearDefinition,
  ragRepairDefinition,
  // Scheduler
  scheduleTaskDefinition,
  listSchedulesDefinition,
  cancelScheduleDefinition,
  runScheduleNowDefinition,
  // Outlook
  emailReadDefinition,
  emailSendDefinition,
  emailSearchDefinition,
  calendarReadDefinition,
  calendarCreateDefinition,
  composeEmailDefinition,
  detectEmailProviderDefinition,
  // Python
  pythonExecDefinition,
  pythonResetDefinition,
  // Whisper
  transcribeAudioDefinition,
  installWhisperDefinition,
  // Long-term memory
  memSaveDefinition,
  memRecallDefinition,
  memListDefinition,
  memForgetDefinition,
  // System monitor
  sysStatsDefinition,
  sysProcessesDefinition,
  sysKillDefinition,
  sysRunDefinition,
  sysEnvDefinition,
  // User files (home dir)
  fileReadDefinition,
  fileWriteDefinition,
  fileListDefinition,
  fileMoveDefinition,
  fileDeleteDefinition,
  fileSearchDefinition,
  fileInfoDefinition,
  // Folder operations
  folderCreateDefinition,
  folderDeleteDefinition,
  folderCopyDefinition,
  openInExplorerDefinition,
  // GitHub
  ghSetTokenDefinition,
  ghAuthStatusDefinition,
  ghReposDefinition,
  ghIssuesDefinition,
  ghPrsDefinition,
  ghCreateIssueDefinition,
  ghRepoInfoDefinition,
  ghSearchDefinition,
  ghCreateBranchDefinition,
  ghCreatePrDefinition,
  ghCommentDefinition,
  ghLabelDefinition,
  ghAssignDefinition,
  ghCloseDefinition,
  ghMergePrDefinition,
  // Desktop automation
  desktopClickDefinition,
  desktopTypeDefinition,
  desktopSendKeysDefinition,
  desktopFindWindowDefinition,
  desktopListWindowsDefinition,
  desktopGetCursorPosDefinition,
  desktopScrollDefinition,
  // Multi-agent
  agentRunDefinition,
  agentParallelDefinition,
  // Web scraping
  webScrapeDefinition,
  webScrapePagesDefinition,
  webScrapeListDefinition,
  webMonitorDefinition,
  webCheckMonitorDefinition,
  webListMonitorsDefinition,
  // Playwright advanced
  browserVaultSaveDefinition,
  browserVaultListDefinition,
  browserLoginDefinition,
  browserStealthDefinition,
  browserWatchDefinition,
  browserRecordStartDefinition,
  browserRecordStopDefinition,
  browserNetworkCaptureDefinition,
  // RAG URL indexing
  ragIndexUrlDefinition,
  // Preview panel
  previewWriteDefinition,
  previewExecDefinition,
  // Tasks & daily briefing
  taskAddDefinition,
  taskListDefinition,
  taskDoneDefinition,
  taskDeleteDefinition,
  taskUpdateDefinition,
  dailyBriefingDefinition,
  connectorActionDryRunDefinition,
  // Inc 17: scheduler enable/disable
  scheduleEnableDefinition,
  scheduleDisableDefinition,
  // Inc 18: agent_status
  agentStatusDefinition,
  // Inc 19: repl_packages
  replPackagesDefinition,
  // Inc 20: workspace_tree
  workspaceTreeDefinition,
  // Inc 21: sysmon additions
  sysServicesDefinition,
  sysPortsDefinition,
  // Inc 22: media additions
  probeMediaDefinition,
  trimVideoDefinition,
  // Inc 23: analyze_screenshot
  analyzeScreenshotDefinition,
  // Inc 24: whisper_status
  whisperStatusDefinition,
  // Inc 25: mem_update, mem_search_tags
  memUpdateDefinition,
  memSearchTagsDefinition,
  // Inc 26: desktop_active_window
  desktopActiveWindowDefinition,
  // Inc 27: cache tools
  cacheStatusDefinition,
  cacheGetDefinition,
  cacheSetDefinition,
  cacheClearDefinition,
  // Inc 28: git_tag, git_cherry_pick
  gitTagDefinition,
  gitCherryPickDefinition,
  // Inc 29: curl tools
  curlImportDefinition,
  curlExportDefinition,
  // Inc 31: plugin management
  pluginListDefinition,
  pluginEnableDefinition,
  pluginDisableDefinition,
  pluginCreateDefinition,
  pluginReadDefinition,
  // Inc 32: webhooks
  webhookRegisterDefinition,
  webhookListDefinition,
  webhookDeleteDefinition,
  webhookToggleDefinition,
  // Inc 33: sys_platform
  sysPlatformDefinition,
]

const handlers: Record<string, ToolHandler> = {
  run_terminal: runTerminal,
  write_file: writeFile,
  read_file: readFile,
  list_directory: listDirectory,
  open_browser: openBrowser,
  fetch_webpage: fetchWebpage,
  list_tabs: listTabs,
  focus_tab: focusTab,
  search_web: searchWeb,
  memory_write: memoryWrite,
  memory_read: memoryRead,
  open_app: openApp,
  take_screenshot: takeScreenshot,
  clipboard_read: clipboardRead,
  clipboard_write: clipboardWrite,
  speak: speak,
  generate_image: generateImage,
  analyze_image: analyzeImage,
  screen_read: screenRead,
  create_slideshow: createSlideshow,
  record_screen: recordScreen,
  convert_video: convertVideo,
  browser_go: browserGo,
  browser_click: browserClick,
  browser_fill: browserFill,
  browser_read: browserRead,
  browser_assert: browserAssert,
  browser_snapshot: browserSnapshot,
  browser_find_targets: browserFindTargets,
  browser_screenshot: browserScreenshot,
  browser_eval: browserEval,
  browser_wait: browserWait,
  browser_select: browserSelect,
  browser_close: browserClose,
  browser_connect_chrome: browserConnectChrome,
  browser_type: browserType,
  browser_key: browserKey,
  browser_hover: browserHover,
  browser_scroll: browserScroll,
  browser_check: browserCheck,
  browser_get_text: browserGetText,
  browser_get_attr: browserGetAttr,
  browser_extract_table: browserExtractTable,
  browser_find_text: browserFindText,
  browser_upload: browserUpload,
  browser_dialog: browserDialog,
  browser_pdf: browserPdf,
  browser_read_emails: browserReadEmails,
  browser_click_email: browserClickEmail,
  browser_compose_reply: browserComposeReply,
  run_code: runCode,
  lint_code: lintCode,
  open_in_editor: openInEditor,
  code_search: codeSearch,
  diff_files: diffFiles,
  patch_file: patchFile,
  code_todos: codeTodos,
  code_stats: codeStats,
  read_pdf: readPdf,
  git_status: gitStatus,
  git_diff: gitDiff,
  git_log: gitLog,
  git_commit: gitCommit,
  git_push: gitPush,
  git_checkout: gitCheckout,
  git_branch: gitBranch,
  git_clone: gitClone,
  git_add: gitAdd,
  git_stash: gitStash,
  git_merge: gitMerge,
  http_request: httpRequest,
  db_query: dbQuery,
  db_execute: dbExecute,
  db_schema: dbSchema,
  db_transaction: dbTransaction,
  db_backup: dbBackup,
  db_query_paged: dbQueryPaged,
  notify: notify,
  browser_new_tab: browserNewTab,
  browser_tabs: browserTabs,
  browser_switch_tab: browserSwitchTab,
  browser_use_tab: browserUseTab,
  browser_close_tab: browserCloseTab,
  // RAG
  rag_index: ragIndex,
  rag_search: ragSearch,
  rag_status: ragStatus,
  rag_clear: ragClear,
  rag_repair: ragRepair,
  // Scheduler
  schedule_task: scheduleTask,
  list_schedules: listSchedules,
  cancel_schedule: cancelSchedule,
  run_schedule_now: runScheduleNow,
  // Outlook
  email_read: emailRead,
  email_send: emailSend,
  email_search: emailSearch,
  calendar_read: calendarRead,
  calendar_create: calendarCreate,
  compose_email: composeEmail,
  detect_email_provider: detectEmailProvider,
  // Python
  python_exec: pythonExec,
  python_reset: pythonReset,
  // Whisper
  transcribe_audio: transcribeAudio,
  install_whisper: installWhisper,
  // Long-term memory
  mem_save: memSave,
  mem_recall: memRecall,
  mem_list: memList,
  mem_forget: memForget,
  // System monitor
  sys_stats: sysStats,
  sys_processes: sysProcesses,
  sys_kill: sysKill,
  sys_run: sysRun,
  sys_env: sysEnv,
  // User files (home dir)
  file_read: fileRead,
  file_write: fileWrite,
  file_list: fileList,
  file_move: fileMove,
  file_delete: fileDelete,
  file_search: fileSearch,
  file_info: fileInfo,
  folder_create: folderCreate,
  folder_delete: folderDelete,
  folder_copy: folderCopy,
  open_in_explorer: openInExplorer,
  // GitHub
  gh_set_token: ghSetToken,
  gh_auth_status: ghAuthStatus,
  gh_repos: ghRepos,
  gh_issues: ghIssues,
  gh_prs: ghPrs,
  gh_create_issue: ghCreateIssue,
  gh_repo_info: ghRepoInfo,
  gh_search: ghSearch,
  gh_create_branch: ghCreateBranch,
  gh_create_pr: ghCreatePr,
  gh_comment: ghComment,
  gh_label: ghLabel,
  gh_assign: ghAssign,
  gh_close: ghClose,
  gh_merge_pr: ghMergePr,
  // Desktop automation
  desktop_click: desktopClick,
  desktop_type: desktopType,
  desktop_send_keys: desktopSendKeys,
  desktop_find_window: desktopFindWindow,
  desktop_list_windows: desktopListWindows,
  desktop_get_cursor_pos: desktopGetCursorPos,
  desktop_scroll: desktopScroll,
  // Multi-agent
  agent_run: agentRun,
  agent_parallel: agentParallel,
  // Web scraping
  web_scrape: webScrape,
  web_scrape_pages: webScrapePages,
  web_scrape_list: webScrapeList,
  web_monitor: webMonitor,
  web_check_monitor: webCheckMonitor,
  web_list_monitors: webListMonitors,
  // Playwright advanced
  browser_vault_save: browserVaultSave,
  browser_vault_list: browserVaultList,
  browser_login: browserLogin,
  browser_stealth: browserStealth,
  browser_watch: browserWatch,
  browser_record_start: browserRecordStart,
  browser_record_stop: browserRecordStop,
  browser_network_capture: browserNetworkCapture,
  // RAG URL indexing
  rag_index_url: ragIndexUrl,
  // Preview panel
  preview_write: previewWrite,
  preview_exec: previewExec,
  // Tasks
  task_add: taskAdd,
  task_list: taskList,
  task_done: taskDone,
  task_delete: taskDelete,
  task_update: taskUpdate,
  daily_briefing: dailyBriefing,
  connector_action_dry_run: connectorActionDryRun,
  // Inc 17: scheduler enable/disable
  schedule_enable: scheduleEnable,
  schedule_disable: scheduleDisable,
  // Inc 18: agent_status
  agent_status: agentStatus,
  // Inc 19: repl_packages
  repl_packages: replPackages,
  // Inc 20: workspace_tree
  workspace_tree: workspaceTree,
  // Inc 21: sysmon additions
  sys_services: sysServices,
  sys_ports: sysPorts,
  // Inc 22: media additions
  probe_media: probeMedia,
  trim_video: trimVideo,
  // Inc 23: analyze_screenshot
  analyze_screenshot: analyzeScreenshot,
  // Inc 24: whisper_status
  whisper_status: whisperStatus,
  // Inc 25: mem_update, mem_search_tags
  mem_update: memUpdate,
  mem_search_tags: memSearchTags,
  // Inc 26: desktop_active_window
  desktop_active_window: desktopActiveWindow,
  // Inc 27: cache tools
  cache_status: cacheStatus,
  cache_get: cacheGet,
  cache_set: cacheSet,
  cache_clear: cacheClear,
  // Inc 28: git_tag, git_cherry_pick
  git_tag: gitTag,
  git_cherry_pick: gitCherryPick,
  // Inc 29: curl tools
  curl_import: curlImport,
  curl_export: curlExport,
  // Inc 31: plugin management
  plugin_list: pluginList,
  plugin_enable: pluginEnable,
  plugin_disable: pluginDisable,
  plugin_create: pluginCreate,
  plugin_read: pluginRead,
  // Inc 32: webhooks
  webhook_register: webhookRegister,
  webhook_list: webhookList,
  webhook_delete: webhookDelete,
  webhook_toggle: webhookToggle,
  // Inc 33: sys_platform
  sys_platform: sysPlatform,
}

// ── Tool execution timing telemetry ──────────────────────────────────────────

interface TimingRecord {
  tool: string
  durationMs: number
  success: boolean
  ts: number
}

const _timingLog: TimingRecord[] = []
const _MAX_TIMING_LOG = 200

// Per-tool aggregate stats
const _toolStats = new Map<string, { calls: number; totalMs: number; errors: number; lastMs: number }>()

function _recordTiming(tool: string, durationMs: number, success: boolean): void {
  _timingLog.push({ tool, durationMs, success, ts: Date.now() })
  if (_timingLog.length > _MAX_TIMING_LOG) _timingLog.splice(0, _timingLog.length - _MAX_TIMING_LOG)
  const s = _toolStats.get(tool) ?? { calls: 0, totalMs: 0, errors: 0, lastMs: 0 }
  s.calls++
  s.totalMs += durationMs
  if (!success) s.errors++
  s.lastMs = durationMs
  _toolStats.set(tool, s)
}

export function getToolTimingStats(): { tool: string; calls: number; avgMs: number; lastMs: number; errorRate: string }[] {
  return Array.from(_toolStats.entries())
    .map(([tool, s]) => ({
      tool,
      calls: s.calls,
      avgMs: Math.round(s.totalMs / s.calls),
      lastMs: s.lastMs,
      errorRate: `${Math.round((s.errors / s.calls) * 100)}%`,
    }))
    .sort((a, b) => b.avgMs - a.avgMs)
}

export function getRecentTimingLog(limit = 50): TimingRecord[] {
  return _timingLog.slice(-limit)
}

export async function executeTool(name: string, args: ToolArgs): Promise<string> {
  const handler = handlers[name]
  if (!handler) {
    return `Error: Unknown tool "${name}". Available: ${Object.keys(handlers).join(', ')}`
  }
  const start = Date.now()
  try {
    const result = await handler(args)
    _recordTiming(name, Date.now() - start, !result.startsWith('Error:'))
    return result
  } catch (err) {
    _recordTiming(name, Date.now() - start, false)
    return `Tool "${name}" error: ${err instanceof Error ? err.message : String(err)}`
  }
}

/** Register tools from a dynamically-loaded plugin */
export function registerPlugin(definitions: ToolDefinition[], pluginHandlers: Record<string, ToolHandler>): void {
  toolDefinitions.push(...definitions)
  for (const [name, handler] of Object.entries(pluginHandlers)) {
    handlers[name] = handler
  }
}
