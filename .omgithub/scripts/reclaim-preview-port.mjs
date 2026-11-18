import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
const execute = promisify(execFile)
async function lsof(args) {
  try { return (await execute('lsof', args)).stdout }
  catch (error) { if (error.code === 1 && !error.stdout && !error.stderr) return ''; throw error }
}
export async function reclaimPreviewPort({ port, project, inspect = lsof, kill = process.kill, wait = delay, uid = process.getuid() }) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid preview port')
  const root = realpathSync(project)
  const listeners = async () => {
    const output = await inspect(['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpu'])
    const records = []
    for (const line of output.split('\n')) {
      if (line.startsWith('p')) records.push({ pid: Number(line.slice(1)) })
      if (line.startsWith('u') && records.length) records.at(-1).uid = Number(line.slice(1))
    }
    return records
  }
  for (const owner of await listeners()) {
    const cwd = (await inspect(['-a', '-p', String(owner.pid), '-d', 'cwd', '-Fn'])).split('\n').find(line => line.startsWith('n'))?.slice(1)
    if (!cwd) continue // It exited between inspections.
    const directory = realpathSync(cwd)
    if (owner.pid === process.pid || owner.uid !== uid || (directory !== root && !directory.startsWith(root + sep))) {
      throw new Error(`Preview port ${port} is occupied by a process outside this project; refusing to stop it`)
    }
    try { kill(owner.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  // Never kill a new listener that appeared after the initial inspection.
  for (let attempt = 0; attempt < 30; attempt++) {
    if (!(await listeners()).length) return
    await wait(100)
  }
  throw new Error(`Preview port ${port} did not become free after stopping the previous project server`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await reclaimPreviewPort({ port: process.env.PORT || 3000, project: process.env.PROJECT_DIR })
}
