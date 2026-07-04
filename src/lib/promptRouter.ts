import type { AppSettings, PromptRoute } from '../types'

const AGENT_ACTION_RE = /\b(open|launch|start|connect|login|log in|sign in|click|type|browse|navigate|go to|download|upload|install|run|execute|terminal|shell|command|create file|edit file|write file|read file|delete file|rename|move file|folder|directory|screenshot|screen|clipboard|email|send|reply|calendar|schedule|task|apply|deploy|commit|push|pull|clone|restart|stop|kill|monitor)\b/i
const CONNECTOR_NAME_RE = /\b(salesforce|gmail|google sheets|sheets|youtube|hubspot|slack|jira|github|notion|airtable|shopify|quickbooks|stripe|aws|azure|zapier|figma|teams|zoom|discord|dropbox|onedrive|trello|asana|zendesk|intercom|linkedin|twitter|instagram|tiktok|reddit|outlook|paypal|square|wordpress|webflow|mailchimp|calendly|docusign|canva|snowflake)\b/i
const ACCOUNT_CONTEXT_RE = /\b(my|our|account|dashboard|records?|leads?|opportunities|inbox|sheet|workspace|channel|tickets?|payments?|orders?|files?|campaigns?|customers?|issues?|projects?|board|repo|repository|portal|console|drive|calendar|contacts?|deals?|pipeline|invoice|subscription)\b/i
const RESEARCH_ROUTE_RE = /\b(research|latest|current|up[- ]?to[- ]?date|sources?|cite|citation|evidence|market|competitor|compare vendors|benchmark|news|recent|verify|fact[- ]?check|investigate|look up|web search|search web|find sources?)\b/i
const DEEP_ROUTE_RE = /\b(deep|thorough|comprehensive|analyze|architecture|design|strategy|tradeoffs?|edge cases?|failure modes?|audit|review|debug|refactor|implement|plan|root cause|security|performance|optimize|diagnose|evaluate|critique|risk|scalable|production)\b/i
const CODE_TASK_RE = /\b(code|typescript|javascript|python|react|server|api|endpoint|component|function|class|test|build|lint|compile|stack trace|error|bug|repo|repository|workspace|diff|pr|pull request)\b/i
const URGENCY_RE = /\b(quick|quickly|fast|brief|short|one[- ]?liner|tl;dr|in one sentence|concise|just tell me)\b/i
const INSTANT_ROUTE_RE = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|what time is it|what date is it)\??$/i
const SIMPLE_KNOWLEDGE_RE = /^(what is|what are|define|explain|summarize|who is|where is|when is|how many|meaning of)\b/i
const FACTUAL_QUESTION_RE = /^(what|which|who|where|when|why|how)\b/i
const AMBIGUOUS_ACTION_RE = /\b(can you|could you|would you|help me|i need|let'?s)\b/i
const LOCAL_PATH_RE = /\b[A-Za-z]:[\\/][^\s]+|(?:^|\s)~[\\/][^\s]+/i
const PROJECT_REVIEW_RE = /\b(review|analy[sz]e|audit|inspect|scan|check|look through|find weak spots?|find issues?)\b[\s\S]{0,120}\b(project|workspace|codebase|repo|repository|folder|directory)\b|\b(project|workspace|codebase|repo|repository|folder|directory)\b[\s\S]{0,120}\b(review|analy[sz]e|audit|inspect|scan|check|look through|find weak spots?|find issues?)\b/i
const PROJECT_BUILD_RE = /\b(let'?s|lets|build|create|make|start|scaffold|set up)\b[\s\S]{0,80}\b(website|web site|web app|app|application|project|dashboard|api|tool|program)\b/i

function clampConfidence(value: number): number {
  return Math.max(0.55, Math.min(0.98, value))
}

function pushSignal(signals: string[], signal: string): void {
  if (!signals.includes(signal)) signals.push(signal)
}

export function routePrompt(
  text: string,
  hasFiles: boolean,
  hasImages: boolean,
  settings: AppSettings,
  manualAgentMode: boolean,
): PromptRoute {
  const trimmed = text.trim()
  const signals: string[] = []
  let agentScore = 0
  let chatScore = 1
  let complexityScore = 0
  let freshnessScore = 0

  const hasAgentAction = AGENT_ACTION_RE.test(trimmed)
  const hasConnector = CONNECTOR_NAME_RE.test(trimmed)
  const hasAccountContext = ACCOUNT_CONTEXT_RE.test(trimmed)
  const hasResearchNeed = RESEARCH_ROUTE_RE.test(trimmed)
  const hasDeepNeed = DEEP_ROUTE_RE.test(trimmed)
  const hasCodeTask = CODE_TASK_RE.test(trimmed)
  const hasUrgency = URGENCY_RE.test(trimmed)
  const ambiguousAction = AMBIGUOUS_ACTION_RE.test(trimmed)
  const simpleKnowledge = SIMPLE_KNOWLEDGE_RE.test(trimmed)
  const factualQuestion = FACTUAL_QUESTION_RE.test(trimmed) && /\?$|\b(created|built|made|founded|invented|programming language|programing language|written in|made with|built with|history|origin|meaning|definition)\b/i.test(trimmed)
  const hasLocalPath = LOCAL_PATH_RE.test(trimmed)
  const hasProjectReview = PROJECT_REVIEW_RE.test(trimmed) || (hasLocalPath && hasDeepNeed)
  const hasProjectBuild = PROJECT_BUILD_RE.test(trimmed) && !/^(how|what|why|explain|tell me)\b/i.test(trimmed)
  const shortPrompt = trimmed.length < 160
  const longPrompt = trimmed.length > 900

  if (hasImages) { agentScore += 5; pushSignal(signals, 'image/vision input') }
  if (hasFiles) { agentScore += 4; pushSignal(signals, 'file attachment') }
  if (hasAgentAction) { agentScore += 3; pushSignal(signals, 'action verb') }
  if (hasConnector && hasAccountContext) { agentScore += 3; pushSignal(signals, 'connector account context') }
  if (hasCodeTask && hasAgentAction) { agentScore += 2; pushSignal(signals, 'code execution/edit task') }
  if (hasProjectBuild) { agentScore += 6; complexityScore += 2; pushSignal(signals, 'project build workflow') }
  if (hasProjectReview) { agentScore += 5; complexityScore += 2; pushSignal(signals, 'project/path review task') }
  if (hasResearchNeed) { agentScore += 3; pushSignal(signals, 'research/web verification') }
  if (hasCodeTask && hasFiles) { agentScore += 2; pushSignal(signals, 'attached code/task context') }
  if (ambiguousAction && hasConnector && hasAccountContext) { agentScore += 1; pushSignal(signals, 'implied account action') }

  if (hasDeepNeed) { complexityScore += 3; pushSignal(signals, 'deep reasoning cue') }
  if (hasCodeTask) { complexityScore += 2; pushSignal(signals, 'technical context') }
  if (longPrompt) { complexityScore += 2; pushSignal(signals, 'long prompt') }
  if (hasResearchNeed) { freshnessScore += 3; pushSignal(signals, 'freshness/source cue') }
  if (hasConnector && hasAccountContext) freshnessScore += 1

  if ((simpleKnowledge || factualQuestion) && !hasAgentAction) { chatScore += 4; pushSignal(signals, 'knowledge question') }
  if (shortPrompt && !hasFiles && !hasImages && !hasAgentAction) chatScore += 1
  if (hasConnector && !hasAccountContext && (simpleKnowledge || factualQuestion)) chatScore += 2
  if (hasUrgency && !hasAgentAction && !hasResearchNeed) { chatScore += 1; pushSignal(signals, 'speed/briefness requested') }

  const useAgent = settings.autoRoute
    ? agentScore >= 3 && agentScore > chatScore
    : manualAgentMode

  let intelligenceMode = settings.intelligenceMode
  let intelligenceReason = 'manual profile'
  if (settings.autoIntelligence) {
    if (hasUrgency && !hasImages && !hasResearchNeed && !hasDeepNeed && !hasCodeTask) {
      intelligenceMode = 'instant'
      intelligenceReason = 'speed requested'
    } else if (hasImages || freshnessScore >= 3) {
      intelligenceMode = 'research'
      intelligenceReason = hasImages ? 'vision review' : 'research/freshness need'
    } else if (complexityScore >= 2) {
      intelligenceMode = 'deep'
      intelligenceReason = hasCodeTask ? 'technical/code task' : 'complex reasoning'
    } else if (INSTANT_ROUTE_RE.test(trimmed) || ((simpleKnowledge || factualQuestion) && shortPrompt && !useAgent)) {
      intelligenceMode = 'instant'
      intelligenceReason = 'short direct answer'
    } else {
      intelligenceMode = 'balanced'
      intelligenceReason = 'normal conversation'
    }
  }

  const scoreGap = Math.abs(agentScore - chatScore)
  const confidence = clampConfidence(0.58 + scoreGap * 0.09 + (signals.length > 1 ? 0.06 : 0))
  const routeReason = useAgent
    ? hasImages ? 'vision/tool task'
      : hasFiles ? 'attachment-aware task'
        : hasConnector && hasAccountContext ? 'connector account work'
          : hasResearchNeed ? 'research/web verification'
            : hasProjectBuild ? 'project builder workflow'
            : hasProjectReview ? 'project/path review'
          : 'tool/action intent'
    : simpleKnowledge ? 'direct knowledge answer'
      : trimmed.length < 140 ? 'direct answer'
        : 'conversation answer'

  return {
    useAgent,
    intelligenceMode,
    reason: `${routeReason}; ${intelligenceReason}`,
    confidence,
    signals,
    scores: {
      agent: agentScore,
      chat: chatScore,
      complexity: complexityScore,
      freshness: freshnessScore,
    },
  }
}