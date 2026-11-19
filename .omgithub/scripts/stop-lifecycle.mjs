import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function alive(pid) {
  try {
    process.kill(pid, 0)
    // An orphaned zombie cannot run or handle signals; do not wait on it.
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      if (stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z')) return false
    }
    return true
  } catch (error) { if (error.code === 'ESRCH' || error.code === 'ENOENT') return false; throw error }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const signal = (pid, name) => { try { process.kill(pid, name) } catch (error) { if (error.code !== 'ESRCH') throw error } }

function killGroups(directory, log) {
  try {
    const groups = JSON.parse(readFileSync(join(directory, 'lifecycle-children.json'), 'utf8'))
    for (const group of groups) if (Number.isSafeInteger(group) && group > 1) signal(-group, 'SIGKILL')
  } catch (error) { log(`Could not terminate recorded child groups: ${error.message}`) }
}

export async function stopLifecycle(pidFile, { waitMs = 210000, pollMs = 1000, log = console.error } = {}) {
  if (!existsSync(pidFile)) return
  const pid = Number(readFileSync(pidFile, 'utf8').trim())
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid lifecycle PID')
  const directory = dirname(pidFile)
  if (alive(pid)) {
    signal(pid, 'SIGTERM')
    const deadline = Date.now() + waitMs
    while (alive(pid) && Date.now() < deadline) await pause(Math.min(pollMs, Math.max(1, deadline - Date.now())))
    if (alive(pid)) {
      log(`Lifecycle ${pid} did not stop after ${waitMs} ms; terminating owned child groups and controller`)
      killGroups(directory, log)
      signal(pid, 'SIGKILL')
      // Preserve the failure while ensuring cleanup finishes before removing runtime files.
      const killedDeadline = Date.now() + 5000
      while (alive(pid) && Date.now() < killedDeadline) await pause(pollMs)
      throw new Error(`Lifecycle shutdown timed out after ${waitMs} ms`)
    }
  }
  const result = join(directory, 'lifecycle-shutdown.json')
  if (!existsSync(result)) {
    killGroups(directory, log)
    throw new Error('Lifecycle exited without a shutdown result; inspect lifecycle.log')
  }
  if (JSON.parse(readFileSync(result, 'utf8')).exitCode !== 0) throw new Error('Lifecycle shutdown failed; inspect lifecycle.log')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const started = Date.now()
  try { await stopLifecycle(join(process.env.OPENCODE_WEB_DIR, 'lifecycle.pid')) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
  finally { console.error(`[timing] lifecycle stop: ${Date.now() - started} ms`) }
}
