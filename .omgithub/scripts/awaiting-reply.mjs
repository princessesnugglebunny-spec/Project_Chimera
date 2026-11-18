// Detect a main turn that ended by asking the user something instead of building.
const writeTools = /^(write|edit|multiedit|patch|apply_patch|create|str_replace|replace)$/i
const questionTools = /^(question|ask|permission|askuser|ask_user)$/i
const created = message => Number(message?.time?.created) || 0

export function latestTurn(messages) {
  if (!Array.isArray(messages)) return []
  // Projections arrive newest first; logs oldest first. Order explicitly.
  const ordered = messages.map((message, index) => ({ message, index })).sort((a, b) => created(b.message) - created(a.message) || b.index - a.index).map(entry => entry.message)
  const turn = []
  for (const message of ordered) {
    if (message?.type === 'user') break
    if (message?.type === 'assistant') turn.push(message)
  }
  return turn
}
function lastText(message) {
  const parts = (message?.content || []).filter(part => part?.type === 'text' && typeof part.text === 'string' && part.text.trim())
  return parts.length ? parts[parts.length - 1].text.trim() : ''
}
export function endsWithQuestion(text) {
  const lines = String(text || '').trim().split('\n').map(line => line.trim()).filter(Boolean)
  const tail = (lines[lines.length - 1] || '').replace(/[\s*_`~>)\]"'”’.!]+$/u, '')
  return /[?？]$/u.test(tail)
}
export function awaitingReply(messages) {
  const turn = latestTurn(messages) // newest assistant first
  if (!turn.length) return { awaiting: false }
  const tools = turn.flatMap(message => (message.content || []).filter(part => part?.type === 'tool'))
  const pending = tools.find(part => questionTools.test(String(part.name || part.tool || '')) && ['pending', 'running'].includes(part.state?.status))
  const message_id = turn[0].id
  if (pending) return { awaiting: true, reason: 'question', message_id }
  const changed = turn.some(message => Array.isArray(message.snapshot?.files) && message.snapshot.files.length) ||
    tools.some(part => writeTools.test(String(part.name || part.tool || '')) && part.state?.status === 'completed')
  if (changed) return { awaiting: false, message_id }
  const final = turn.find(message => lastText(message))
  const text = lastText(final)
  if (!endsWithQuestion(text)) return { awaiting: false, message_id }
  return { awaiting: true, reason: 'text', message_id, question: text.slice(-600) }
}
