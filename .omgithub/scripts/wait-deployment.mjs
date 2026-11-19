import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

// Waits for the final main turn's delivery. When that turn asked the user a question
// (state awaiting_reply), keep waiting for a reply prompt, then re-arm on the next turn.
export async function waitForDeployment({ directory, now = Date.now, pause = setTimeout, timeoutMs = 20 * 60_000, replyTimeoutMs = 60 * 60_000, overallMs = 240 * 60_000, deadlineAt = Infinity, reconcile = async () => {}, log = () => {} }) {
  const read = name => {
    try { return JSON.parse(readFileSync(join(directory, name), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error }
  }
  const completion = read('main-completion.json')
  const started = now(), hardStop = Math.min(started + overallMs, deadlineAt)
  let deadline = started + timeoutMs
  let target = completion?.message_id || null
  const answered = new Set()
  let awaiting = null, reconciliationError
  while (now() < Math.min(awaiting ? awaiting.until : deadline, hardStop)) {
    try { await reconcile(); reconciliationError = null }
    catch (error) { reconciliationError = error.message }
    const status = read('deployment-status.json')
    if (awaiting) {
      // A reply prompt starts a newer lifecycle generation (its first status still carries the old message id).
      if (status && Number(status.generation) > awaiting.generation && !(status.state === 'awaiting_reply' && status.message_id === awaiting.message_id)) {
        answered.add(awaiting.message_id)
        log(`Reply received after question ${awaiting.message_id}; waiting for the next delivery.`)
        awaiting = null; target = null; deadline = now() + timeoutMs
        continue
      }
      await pause(1000)
      continue
    }
    // An earlier turn may still be ready while the final completion is queued.
    const current = status && (target ? status.message_id === target : (!answered.size || (status.message_id && !answered.has(status.message_id))))
    if (current && status.state === 'awaiting_reply') {
      awaiting = { message_id: status.message_id, generation: Number(status.generation) || 0, until: now() + replyTimeoutMs }
      log(`OpenCode asked a question (${status.message_id}); waiting up to ${Math.round(replyTimeoutMs / 60000)} min for a reply.`)
      continue
    }
    if (current && status.state === 'failed') throw new Error(status.error || 'Production delivery failed')
    if (current && status.state === 'ready') {
      const result = read('deployment-result.json')
      if (!result?.preview_url || String(result.generation) !== String(status.generation) || !Array.isArray(result.screenshots) || result.screenshots.length < 2) throw new Error('Incomplete production delivery')
      return result
    }
    await pause(1000)
  }
  if (awaiting) return { awaiting_reply: true, message_id: awaiting.message_id }
  throw new Error(`Production delivery timed out${reconciliationError ? `: ${reconciliationError}` : ''}`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env
  const jobStart = /^\d+$/.test(env.JOB_STARTED_AT || '') ? Number(env.JOB_STARTED_AT) * 1000 : Date.parse(env.JOB_STARTED_AT || '')
  try {
    const result = await waitForDeployment({ directory: env.OPENCODE_WEB_DIR, log: message => console.log(message),
      // Leave room for checkpoint and cleanup steps inside the 305-minute job timeout.
      deadlineAt: Number.isFinite(jobStart) ? jobStart + 300 * 60_000 : Infinity,
      reconcile: async () => {
        if (!env.OPENCODE_CONTROL_PORT) return
        const response = await fetch(`http://127.0.0.1:${env.OPENCODE_CONTROL_PORT}/omgithub/reconcile`, { signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw new Error(`Deployment reconciliation HTTP ${response.status}`)
      } })
    if (result.awaiting_reply) {
      writeFileSync(join(env.OPENCODE_WEB_DIR, 'awaiting-ended.json'), JSON.stringify({ message_id: result.message_id, ended_at: new Date().toISOString() }))
      if (env.GITHUB_ENV) appendFileSync(env.GITHUB_ENV, 'AWAITING_REPLY_ENDED=true\n')
      console.log('No reply arrived in time; ending the session while it waits for your reply.')
    } else console.log('Production delivery completed checkpoint, capture, and deployment.')
  } catch (error) {
    if (env.OPENCODE_WEB_DIR) writeFileSync(join(env.OPENCODE_WEB_DIR, 'delivery-failure.json'), JSON.stringify({ message: error.message }))
    console.error(error.message)
    process.exit(1)
  }
}
