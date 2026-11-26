import { spawn } from 'node:child_process'
import { openSync, closeSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const toml = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** frpc config: one client, three HTTP proxies (OpenCode, live files, final preview). */
export function frpcConfig({ server, port, proxies, hosts, metas, ports }) {
  const lines = [
    `serverAddr = ${toml(server)}`,
    `serverPort = ${Number(port)}`,
    'transport.tls.enable = true',
    'transport.heartbeatInterval = 20',
    'transport.tcpMuxKeepaliveInterval = 20',
    `metadatas = { ${Object.entries(metas).map(([k, v]) => `${k}=${toml(v)}`).join(', ')} }`,
  ]
  for (const [service, name] of Object.entries(proxies)) lines.push(
    '', '[[proxies]]', `name = ${toml(name)}`, 'type = "http"', `localPort = ${ports[service]}`, `customDomains = [${toml(hosts[service])}]`,
  )
  return `${lines.join('\n')}\n`
}

export async function workerTunnel(env, mode = 'start', request = fetch) {
  const started = Date.now()
  const directory = env.OPENCODE_WEB_DIR
  const configPath = join(directory, 'frpc.toml'), logPath = join(directory, 'frpc.log'), pidPath = join(directory, 'frpc.pid')
  try {
    const endpoint = `${env.OMGITHUB_ORIGIN || 'https://omgithub.com'}/api/github/${env.GITHUB_REPOSITORY}/issues/${env.TRIGGER_ISSUE_NUMBER}/tunnel`
    const ports = { oc: Number(env.OPENCODE_CONTROL_PORT), files: Number(env.PROJECT_FILE_PORT), live: Number(env.APP_PORT) }
    const response = await request(endpoint, { method: mode === 'start' ? 'POST' : 'DELETE', headers: {
      authorization: `Bearer ${env.OMGITHUB_CALLBACK_TOKEN}`, 'content-type': 'application/json'
    }, body: JSON.stringify({ run: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT || 1), ...(mode === 'start' ? { ports, tunnel: 'frp' } : {}) }), signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error(`Worker tunnel ${mode}: HTTP ${response.status}`)
    if (mode !== 'start') return
    const { urls, frp } = await response.json()
    if (!frp?.server || !Number.isInteger(frp.port) || !['oc', 'files', 'live'].every(k => /^https:\/\/[a-z0-9-]+\.omgithub\.com$/.test(urls?.[k] || '') && /^[a-z0-9-]+$/.test(frp.proxies?.[k] || ''))) throw new Error('Invalid worker tunnel configuration')
    const [owner, repo] = String(env.GITHUB_REPOSITORY || '').split('/')
    const metas = { owner, repo, number: String(env.TRIGGER_ISSUE_NUMBER), run: String(env.GITHUB_RUN_ID), attempt: String(env.GITHUB_RUN_ATTEMPT || 1), token: env.OMGITHUB_CALLBACK_TOKEN }
    console.log(`::add-mask::${env.OMGITHUB_CALLBACK_TOKEN}`)
    const hostnames = Object.fromEntries(['oc', 'files', 'live'].map(k => [k, new URL(urls[k]).hostname]))
    writeFileSync(configPath, frpcConfig({ server: frp.server, port: frp.port, proxies: frp.proxies, hosts: hostnames, metas, ports }), { mode: 0o600 })
    const log = openSync(logPath, 'a', 0o600)
    try {
      const child = spawn(join(directory, 'frpc'), ['-c', configPath], { cwd: directory, detached: true, stdio: ['ignore', log, log] })
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
      writeFileSync(pidPath, String(child.pid))
      child.unref()
    } finally { closeSync(log) }
    for (const [file, url] of [['web-url', urls.oc], ['files-url', urls.files + '/'], ['app-url', urls.live]]) writeFileSync(join(directory, file), url)
    appendFileSync(env.GITHUB_ENV, `APP_URL=${urls.live}\n`)
    appendFileSync(env.GITHUB_OUTPUT, `url=${urls.oc}\nproject_url=${urls.files}/\n`)
    for (let attempt = 0; attempt < 60; attempt++) {
      const output = readFileSync(logPath, 'utf8')
      if (output.includes('login to the server failed') || output.includes('start proxy error')) throw new Error(`Worker tunnel rejected: ${output.trim().split('\n').filter(line => /error|failed/.test(line)).at(-1) || 'unknown error'}`)
      if ((output.match(/start proxy success/g) || []).length >= 3) return
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw new Error('Worker tunnel did not register within 60 seconds')
  } finally { console.error(`[timing] worker tunnel ${mode}: ${Date.now() - started} ms`) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await workerTunnel(process.env, process.argv[2])
