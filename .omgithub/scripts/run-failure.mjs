import { openSync, fstatSync, readSync, closeSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildStats } from './build-stats.mjs'

// Report actionable categories, not arbitrary provider bodies or user/tool text.
export function modelFailureReason(log) {
  let failure
  for (const line of String(log).split('\n')) {
    try { const row = JSON.parse(line); if (row.type === 'error' && row.error && typeof row.error === 'object') failure = row.error } catch {}
  }
  if (!failure) return 'The build workflow failed. Open the workflow logs for details.'
  const type = String(failure.type || ''), message = String(failure.message || '')
  // Provider wrappers report the status inside the message text ("Copilot /auto returned HTTP 401").
  const status = Number(failure.status) || Number(/HTTP\s+(\d{3})\b/.exec(message)?.[1]) || 0
  // Echo only short provider status lines, never arbitrary provider bodies or user text.
  const safe = message.replace(/\s+/g, ' ').replace(/\. For more information.*$/, '').trim()
  const detail = /^(?:Copilot|OpenCode|OpenRouter|GitHub) .{0,120}?\bHTTP \d{3}\b/.test(safe) || /^Transport: .{0,140}$/.test(safe) ? ` (${safe.slice(0, 160)})` : ''
  if (type === 'provider.free-limit' || /FreeUsageLimit|free usage limit/i.test(message)) return 'We’re running low on spare robot brains. Please try again in a moment!'
  if (status === 429 || /rate.limit/i.test(type)) return `The model provider rate limit was reached${detail}. Wait for quota to reset or choose a model with available quota.`
  if ([401, 403].includes(status)) return `The model provider rejected its credentials${detail}. Check the connected provider in Settings.`
  if (/model.*not.found|not.found.*model/i.test(type)) return 'The selected model is unavailable. Choose another model.'
  return `OpenCode could not complete the request${detail}. Open the workflow logs for details.`
}
// Delivery problems happen after the AI finished; never blame an earlier model attempt for them.
export function deliveryFailureReason(message) {
  const text = String(message || '')
  if (/timed out/i.test(text)) return 'Publishing timed out: the game was not ready within 20 minutes of the AI finishing. Open the workflow logs for details.'
  if (/Incomplete production delivery/i.test(text)) return 'Publishing failed: the preview or screenshots were incomplete. Open the workflow logs for details.'
  if (/index\.html|package project|preview/i.test(text)) return 'Publishing failed: no playable game was produced. Open the workflow logs for details.'
  return 'Publishing failed after the AI finished. Open the workflow logs for details.'
}
const readJson = (directory, name) => { try { return JSON.parse(readFileSync(join(directory, name), 'utf8')) } catch { return null } }
export function readFailureReason(directory) {
  if (!directory) return modelFailureReason('')
  const delivery = readJson(directory, 'delivery-failure.json')
  if (delivery) return deliveryFailureReason(delivery.message)
  const attempts = readJson(directory, 'model-attempts.json')
  // A later model succeeded, so earlier free-limit errors in the log are not the cause.
  if (Array.isArray(attempts) && attempts.length && attempts[attempts.length - 1]?.code === 0) return 'The build workflow failed after the AI finished. Open the workflow logs for details.'
  let fd
  try {
    fd = openSync(join(directory, 'opencode-run.log'), 'r')
    const size = fstatSync(fd).size, length = Math.min(size, 65536), bytes = Buffer.alloc(length)
    readSync(fd, bytes, 0, length, size - length)
    return modelFailureReason(bytes.toString('utf8'))
  } catch (error) { if (error.code === 'ENOENT') return modelFailureReason(''); throw error }
  finally { if (fd !== undefined) closeSync(fd) }
}
export function failurePayload(env, sequence = Date.now()) {
  return { run: String(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT || 1), sequence: Number(sequence), state: 'ended', phase: 'building', outcome: 'failure', reason: readFailureReason(env.OPENCODE_WEB_DIR), ...buildStats(env.OPENCODE_WEB_DIR) }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(process.argv[2] === '--payload' ? JSON.stringify(failurePayload(process.env, process.argv[3])) : readFailureReason(process.env.OPENCODE_WEB_DIR))
}
