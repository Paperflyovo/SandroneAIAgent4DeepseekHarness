const PREVIEW_LIMIT = 180
const ACTIVITY_LIMIT = 700

function compactText(value, limit = PREVIEW_LIMIT) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text ? text.slice(0, limit) : undefined
}

export function contentText(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .trim()
}

export function summarizeBuddyActivity(activity) {
  const parts = []
  const title = compactText(activity?.sessionTitle, 80)
  const user = compactText(activity?.latestUserMessage)
  const assistant = compactText(activity?.latestAssistantReply)
  if (title) parts.push(`当前会话：${title}`)
  if (user) parts.push(`用户最近说：${user}`)
  if (assistant) parts.push(`主 Agent 最近回复：${assistant}`)
  if (activity?.recentTools?.length) parts.push(`最近工具：${activity.recentTools.slice(-3).join('、')}`)
  if (activity?.activeTaskCount) parts.push(`进行中的任务：${activity.activeTaskCount} 个`)
  const task = compactText(activity?.latestTaskStatus, 80)
  if (task) parts.push(`最新任务状态：${task}`)
  return (parts.join('\n') || '暂无可用的近期活动').slice(0, ACTIVITY_LIMIT)
}

export function collectBuddyActivity(events, projections = {}) {
  let sessionTitle = typeof projections?.values?.title === 'string' ? projections.values.title : undefined
  let latestUserMessage
  let latestAssistantReply
  let todos = Array.isArray(projections?.values?.todos) ? projections.values.todos : []
  const recentTools = []

  for (const entry of Array.isArray(events) ? events : []) {
    const event = entry?.event
    if (!event || typeof event.type !== 'string') continue
    if (event.type === 'session/title' && typeof event.data?.title === 'string') sessionTitle = event.data.title
    if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
      latestUserMessage = contentText(event.data.content)
    }
    if (event.type === 'assistant/message') {
      latestAssistantReply = contentText(event.data?.message?.content)
    }
    if (event.type === 'tool/call' && typeof event.data?.name === 'string') recentTools.push(event.data.name)
    if (event.type === 'todo/write' && Array.isArray(event.data?.todos)) todos = event.data.todos
  }

  const activeTodos = todos.filter(todo => todo?.status !== 'completed')
  const latestTodo = [...activeTodos].reverse().find(todo => todo?.status === 'in_progress')
    || activeTodos.at(-1)
    || todos.at(-1)
  const activity = {
    sessionTitle: compactText(sessionTitle, 80),
    latestUserMessage: compactText(latestUserMessage),
    latestAssistantReply: compactText(latestAssistantReply),
    recentTools: recentTools.slice(-3),
    activeTaskCount: activeTodos.length,
    latestTaskStatus: latestTodo?.content
      ? `${compactText(latestTodo.content, 60)}（${latestTodo.status || 'unknown'}）`
      : undefined,
  }
  return { ...activity, summary: summarizeBuddyActivity(activity) }
}

const FAST_KEYWORDS = new Map([
  ['flash', 8],
  ['haiku', 8],
  ['fast', 7],
  ['mini', 6],
  ['lite', 6],
  ['small', 6],
  ['turbo', 4],
])
const HEAVY_KEYWORDS = new Map([
  ['reasoner', 7],
  ['thinking', 7],
  ['ultra', 6],
  ['opus', 5],
  ['max', 4],
  ['pro', 3],
])

function modelScore(model) {
  const text = `${model?.id || ''} ${model?.name || ''} ${model?.description || ''}`.toLowerCase()
  let score = 0
  let fastMatch = false
  for (const [keyword, weight] of FAST_KEYWORDS) {
    if (!text.includes(keyword)) continue
    score += weight
    fastMatch = true
  }
  for (const [keyword, weight] of HEAVY_KEYWORDS) {
    if (text.includes(keyword)) score -= weight
  }
  return { score, fastMatch }
}

export function lowestBuddyEffort(model) {
  const efforts = model?.reasoning?.efforts
  if (!Array.isArray(efforts) || efforts.length === 0) return undefined
  const priorities = ['disabled', 'none', 'off', 'minimal', 'low', 'light']
  for (const priority of priorities) {
    const match = efforts.find(effort => `${effort?.id || ''} ${effort?.name || ''}`.toLowerCase().includes(priority))
    if (match?.id) return match.id
  }
  return efforts[0]?.id
}

export function chooseBuddyModel(sessionModels) {
  const current = sessionModels?.current
  if (!current?.provider || !current?.model) throw new Error('主会话没有可用的模型配置')
  const group = sessionModels.groups?.find(item => item?.id === current.provider)
  const currentModel = group?.models?.find(model => model?.id === current.model)
  const candidates = (group?.models || [])
    .filter(model => model?.id)
    .map((model, index) => ({ model, index, ...modelScore(model) }))
    .filter(candidate => candidate.fastMatch && candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
  const selected = candidates[0]?.model || currentModel || { id: current.model }
  const reasoningEffort = lowestBuddyEffort(selected)
  return {
    provider: current.provider,
    model: selected.id,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }
}

export function sameBuddyModel(current, selected) {
  if (!current || !selected) return false
  if (current.provider !== selected.provider || current.model !== selected.model) return false
  return selected.reasoningEffort === undefined || current.reasoningEffort === selected.reasoningEffort
}
