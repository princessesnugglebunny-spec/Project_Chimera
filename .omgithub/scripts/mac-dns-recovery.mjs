import { Resolver } from 'node:dns/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
let pending

// Repair only disposable Actions Macs, and only after DNS publication is proven.
export async function recoverMacDns(host, error, {
  enabled = process.platform === 'darwin' && process.env.GITHUB_ACTIONS === 'true',
  resolve = async name => {
    const resolver = new Resolver({ timeout: 2000, tries: 1 })
    resolver.setServers(['1.1.1.1', '8.8.8.8'])
    return resolver.resolve4(name)
  },
  flush = async () => {
    for (const args of [['dscacheutil', '-flushcache'], ['killall', '-HUP', 'mDNSResponder']]) {
      const started = Date.now()
      try { await exec('sudo', ['-n', ...args], { timeout: 5000 }) }
      finally { console.log(`[timing] DNS recovery ${args[0]}: ${Date.now() - started} ms`) }
    }
  }
} = {}) {
  const code = error?.cause?.code || error?.code
  if (!enabled || !['ENOTFOUND', 'EAI_AGAIN'].includes(code) || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(host)) return false
  try {
    if (!(await resolve(host)).length) return false
    console.warn(`Public DNS resolves ${host}, but the Mac lookup returned ${code}; flushing stale cache.`)
    if (!pending) pending = Promise.resolve().then(flush).finally(() => { pending = undefined })
    await pending
    return true
  } catch { return false }
}
