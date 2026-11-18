// Numbers-only OpenCode V2 session stats (never prompts, outputs or file contents).
// Reads session messages and subagent children once; tolerates missing fields.
const num = value => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0)
const FILE_TOOLS = /^(edit|write|multiedit|apply_patch|patch)$/i
const ts = value => { const n = typeof value === 'string' ? Date.parse(value) : Number(value); return Number.isFinite(n) && n > 0 ? n : null }

function partsOf(message) {
  const out = []
  for (const key of ['parts', 'content']) if (Array.isArray(message?.[key])) out.push(...message[key])
  return out
}
function toolOf(item) {
  if (!item || typeof item !== 'object') return null
  if (item.type === 'tool' || item.type === 'tool-call' || item.type === 'tool_use') return item
  return null
}
function isImage(tool) {
  const s = tool.state || {}
  const mimes = [tool.mime, s.mime, s.metadata?.mime, tool.metadata?.mime, ...(Array.isArray(s.attachments) ? s.attachments.map(a => a?.mime) : []), ...(Array.isArray(tool.attachments) ? tool.attachments.map(a => a?.mime) : [])]
  return mimes.some(m => typeof m === 'string' && m.startsWith('image/'))
}

export function messageStats(messages = [], acc = emptyStats()) {
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message !== 'object') continue
    if (['assistant', 'user'].includes(message.type)) acc.messages++
    const t = message.tokens
    if (t && typeof t === 'object') {
      acc.tokens_input += num(t.input); acc.tokens_output += num(t.output); acc.tokens_reasoning += num(t.reasoning)
      acc.tokens_cache_read += num(t.cache?.read); acc.tokens_cache_write += num(t.cache?.write)
      const start = ts(message.time?.streamed), end = ts(message.time?.completed)
      if (start && end && end > start && num(t.output) + num(t.reasoning) > 0) { acc._gen_tokens += num(t.output) + num(t.reasoning); acc._gen_ms += end - start }
    }
    const tools = [toolOf(message), ...partsOf(message).map(toolOf)].filter(Boolean)
    for (const tool of tools) {
      const name = String(tool.tool || tool.name || 'unknown').replace(/[^\w.:-]/g, '').slice(0, 40) || 'unknown'
      acc.tool_calls++; acc.tools[name] = (acc.tools[name] || 0) + 1
      if (isImage(tool)) acc.image_calls++
      const input = tool.input || tool.state?.input || {}
      const path = input.filePath || input.file_path || input.path
      if (FILE_TOOLS.test(name) && typeof path === 'string') acc._files.add(path)
    }
  }
  return acc
}
export function emptyStats() {
  return { messages: 0, tokens_input: 0, tokens_output: 0, tokens_reasoning: 0, tokens_cache_read: 0, tokens_cache_write: 0, tool_calls: 0, tools: {}, image_calls: 0, _files: new Set(), _gen_tokens: 0, _gen_ms: 0, total_subagents: 0, failed_subagents: 0 }
}
const childFailed = (child, messages) => Boolean(child?.error) || (Array.isArray(messages) && messages.some(m => m?.type === 'idle' && m.outcome === 'failed'))

// Final numbers in the v1 telemetry `stats` shape plus V2 extras.
export function finishStats(acc, extra = {}) {
  const model_tokens = acc.tokens_input + acc.tokens_output + acc.tokens_reasoning + acc.tokens_cache_read + acc.tokens_cache_write
  const top = Object.entries(acc.tools).sort((a, b) => b[1] - a[1]).slice(0, 20)
  return {
    model_tokens, tokens_input: acc.tokens_input, tokens_output: acc.tokens_output, tokens_reasoning: acc.tokens_reasoning,
    tokens_cache_read: acc.tokens_cache_read, tokens_cache_write: acc.tokens_cache_write,
    ...(acc._gen_ms > 0 ? { output_tokens_per_second: Math.round(acc._gen_tokens / (acc._gen_ms / 1000) * 10) / 10 } : {}),
    tool_calls: acc.tool_calls, tools: Object.fromEntries(top), image_calls: acc.image_calls, changed_files: acc._files.size,
    total_subagents: acc.total_subagents, failed_subagents: acc.failed_subagents, active_subagents: 0, active_tool_calls: 0, messages: acc.messages, ...extra
  }
}

export async function collectSessionStats(api, sessionID, { children = id => api.children?.(id) } = {}) {
  const acc = emptyStats()
  messageStats(await api.messages(sessionID), acc)
  let kids = []
  try { kids = (await children(sessionID)) || [] } catch {}
  for (const child of Array.isArray(kids) ? kids.slice(0, 50) : []) {
    if (!child?.id) continue
    acc.total_subagents++
    let messages = []
    try { messages = await api.messages(child.id) } catch {}
    messageStats(messages, acc)
    if (childFailed(child, messages)) acc.failed_subagents++
  }
  return acc
}
