import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
export function runnerDeadline({ started, lastActivity, now, idleMs = 3600000, maxMs = 18000000 }) {
  return now - started >= maxMs ? 'Reached five-hour runner limit.' : now - lastActivity >= idleMs ? 'Stopped after one hour without OpenCode activity.' : null
}
export async function watchRunner(mode, { env = process.env, now = Date.now, pause = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const dir = env.OPENCODE_WEB_DIR
  const start = Number(env.JOB_STARTED_AT) * 1000 || now()
  let last = start, previous = '', delivery = ''
  while (true) {
    const activity = (() => { try { return JSON.parse(readFileSync(join(dir, 'runner-activity.json'), 'utf8')).at } catch { return 0 } })()
    if (activity > last) last = activity
    try {
      const stat = statSync(join(dir, 'opencode-run.log'))
      const signature = `${stat.size}:${stat.mtimeMs}`
      if (signature !== previous) { last = Math.max(last, stat.mtimeMs); previous = signature }
    } catch {}
    // Publication starts the preview hour, once per completed generation.
    if (mode === 'preview') try {
      const status = JSON.parse(readFileSync(join(dir, 'deployment-status.json'), 'utf8'))
      const key = `${status.generation}:${status.state}`
      if (status.state === 'ready' && key !== delivery) {
        last = now(); delivery = key
      }
    } catch {}
    try {
      const stopped = JSON.parse(readFileSync(join(dir, 'runner-stop.json'), 'utf8'))
      if (mode === 'build') throw new Error(stopped.reason)
      return stopped.reason
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
    const reason = runnerDeadline({ started: start, lastActivity: last, now: now() })
    if (reason) {
      writeFileSync(join(dir, 'runner-stop.json'), JSON.stringify({ reason, at: new Date(now()).toISOString() }))
      console.log(reason)
      if (mode === 'build') {
        for (const file of ['opencode-run.pid', 'lifecycle.pid']) try {
          const pid = Number(readFileSync(join(dir, file), 'utf8').trim())
          if (Number.isSafeInteger(pid) && pid > 1) process.kill(pid, 'SIGTERM')
        } catch {}
        throw new Error(reason)
      }
      return reason
    }
    if (mode === 'build') try { readFileSync(join(dir, 'opencode-run.exit')); return } catch {}
    await pause(10000)
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await watchRunner(process.argv[2] || 'build')
