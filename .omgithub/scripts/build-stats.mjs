import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_ATTEMPTS = 8
const readText = (directory, name) => { try { return readFileSync(join(directory, name), 'utf8').trim() } catch { return '' } }
const readJson = (directory, name) => { try { return JSON.parse(readFileSync(join(directory, name), 'utf8')) } catch { return null } }

// Optional admin stats for /run posts: WARP outcome, current and final model,
// per-attempt results and elapsed time. Missing files simply omit fields.
export function buildStats(directory, now = Date.now()) {
  if (!directory) return {}
  const stats = {}
  const warp = readJson(directory, 'warp-status.json')
  if (warp && typeof warp === 'object') {
    stats.warp = { decision: warp.decision, result: warp.result }
    for (const key of ['attempt', 'egress_prefix', 'egress_prefix64', 'colo', 'warp_result']) if (warp[key] !== undefined && warp[key] !== '') stats.warp[key] = warp[key]
  }
  const model = readText(directory, 'main-model')
  if (model) stats.model = model
  // Pinned runner commit for this build, so the project page can show which runtime ran it.
  const runtime = readText(directory, 'runtime-ref.txt')
  if (/^[a-f0-9]{40}$/i.test(runtime)) stats.runtime = runtime.toLowerCase()
  const attempts = readJson(directory, 'model-attempts.json')
  if (Array.isArray(attempts) && attempts.length) {
    stats.attempts = attempts.slice(-MAX_ATTEMPTS).map(({ model, outcome, code, error_class, duration_ms }) => ({ model, outcome, code, ...(error_class ? { error_class } : {}), duration_ms }))
    const done = attempts.findLast(attempt => attempt?.code === 0)
    if (done?.model) stats.final_model = done.model
    // OpenCode's own working time: wall time of each `opencode run` attempt (spawn to exit + terminal check).
    // Unlike duration_ms it excludes runner setup and the post-build access hold (up to 5 h on success).
    const work = attempts.map(attempt => Number(attempt?.duration_ms)).filter(ms => Number.isFinite(ms) && ms >= 0)
    if (work.length) stats.opencode_ms = Math.round(work.reduce((sum, ms) => sum + ms, 0))
  }
  const oc = readJson(directory, 'opencode-stats.json')
  if (oc && typeof oc === 'object') stats.opencode_stats = Object.fromEntries(Object.entries(oc).filter(([key, value]) => key === 'tools' ? value && typeof value === 'object' : Number.isFinite(value)))
  const started = Number(readText(directory, 'build-started-at'))
  if (Number.isFinite(started) && started > 0 && now >= started) stats.duration_ms = now - started
  return stats
}
