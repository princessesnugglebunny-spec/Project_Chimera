import { createV2Client, v2SessionUrl } from './opencode-v2-api.mjs'
import { V2LifecycleBridge, isV2MainInterrupt, isV2MainPrompt } from './session-lifecycle-v2.mjs'
import { registerRun } from './run-record.mjs'
import { awaitingReply } from './awaiting-reply.mjs'
import { uploadScreenshots } from './wip-upload.mjs'
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Serialize checkpoint/validation workers. Invalidate before aborting: a late
// child result must never become current while a new main message is starting.
export function bounded(operation, milliseconds, label) {
  const controller = new AbortController()
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${milliseconds} ms`))
      controller.abort()
    }, milliseconds)
  })
  return Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]).finally(() => clearTimeout(timer))
}

const children = new Set()
let recordChildren = () => {}
export function terminateChildren() {
  for (const proc of children) signalChild(proc, 'SIGKILL')
}
function signalChild(proc, signal) {
  try { process.kill(-proc.pid, signal) } catch { try { proc.kill(signal) } catch {} }
}

export async function registerDeployment(env, state, generation, error = '', requestFetch = fetch) {
  const context = `run=${env.GITHUB_RUN_ID} attempt=${env.GITHUB_RUN_ATTEMPT || 1} state=${state} generation=${generation}`
  try {
    const response = await requestFetch(`${env.OMGITHUB_ORIGIN || 'https://omgithub.com'}/api/github/${env.GITHUB_REPOSITORY}/issues/${env.TRIGGER_ISSUE_NUMBER}/deployment`, {
      method: 'POST', headers: { authorization: `Bearer ${env.OMGITHUB_CALLBACK_TOKEN || ''}`, 'x-omgithub-run': env.GITHUB_RUN_ID, 'x-omgithub-attempt': env.GITHUB_RUN_ATTEMPT || '1', 'x-omgithub-generation': String(generation), 'x-omgithub-state': state, 'x-omgithub-error': encodeURIComponent(error).slice(0, 1000) }, signal: AbortSignal.timeout(30000)
    })
    if (!response.ok) {
      const body = (await response.text()).slice(0, 2000).replace(/\s+/g, ' ').trim()
      throw new Error(`HTTP ${response.status}${body ? `: ${body}` : ''}`)
    }
  } catch (error) { throw new Error(`Deployment registration ${context}: ${error.message}`, { cause: error }) }
}

export class Lifecycle {
  constructor({ save, deploy, status = () => {}, awaiting = async () => false }) { Object.assign(this, { save, deploy, status, awaiting }); this.generation = 0; this.active = null; this.lastMessage = ''; this.stopping = false }
  async busy() {
    const generation = ++this.generation
    const active = this.active
    active?.controller.abort()
    if (generation === this.generation) await this.status('working', generation)
    if (active) await active.promise.catch(() => {})
    return generation
  }
  async complete(messageID) {
    if (this.stopping || !messageID || messageID === this.lastMessage) return
    this.lastMessage = messageID
    let generation
    try { generation = await this.busy() }
    catch (error) {
      if (this.lastMessage === messageID) this.lastMessage = ''
      await Promise.resolve(this.status('failed', this.generation, error.message)).catch(() => {})
      throw error
    }
    if (generation !== this.generation || this.stopping) return
    const controller = new AbortController()
    const current = () => !controller.signal.aborted && generation === this.generation && !this.stopping
    const promise = (async () => {
      await this.status('saving', generation)
      const checkpoint = await this.save(controller.signal)
      if (!current() || !checkpoint) return
      // A turn that only asked the user a question has nothing to deliver; skip preview repairs.
      if (await Promise.resolve(this.awaiting({ messageID, signal: controller.signal })).catch(() => false)) {
        if (current()) await this.status('awaiting_reply', generation)
        return
      }
      if (!current()) return
      await this.status('deploying', generation)
      await this.deploy({ checkpoint, messageID, generation, signal: controller.signal, current })
      if (current()) await this.status('ready', generation)
    })().catch(async error => { if (current()) await Promise.resolve(this.status('failed', generation, error.message)).catch(() => {}) })
    this.active = { controller, promise }
    await promise
    if (this.active?.promise === promise) this.active = null
  }
  shutdown({ drainMs = 10000, saveMs = 150000, log = message => process.stderr.write(`${message}\n`) } = {}) {
    if (this.shutdownPromise) return this.shutdownPromise
    this.stopping = true
    ++this.generation
    const active = this.active
    active?.controller.abort()
    this.shutdownPromise = (async () => {
      if (active) {
        try { await bounded(() => active.promise.catch(() => {}), drainMs, 'Shutdown worker drain') }
        catch (error) { log(error.message); terminateChildren() }
      }
      await bounded(signal => this.save(signal, true), saveMs, 'Shutdown checkpoint save')
    })()
    return this.shutdownPromise
  }
}

export function child(file, args, { signal, killGraceMs = 5000, settleGraceMs = 1000, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const proc = spawn(file, args, { stdio: ['ignore', 'inherit', 'pipe'], detached: process.platform !== 'win32', ...options })
    if (proc.pid) { children.add(proc); recordChildren() }
    let stderr = '', forced, deadline, settled = false
    proc.stderr?.on('data', chunk => { process.stderr.write(chunk); stderr = (stderr + chunk.toString()).slice(-4000) })
    const finish = error => {
      if (settled) return
      settled = true
      clearTimeout(forced); clearTimeout(deadline); signal?.removeEventListener('abort', abort)
      // Even if the leader exits first, terminate descendants in its detached group.
      if (signal?.aborted) signalChild(proc, 'SIGKILL')
      children.delete(proc); recordChildren()
      proc.stderr?.destroy()
      process.stderr.write(`[timing] ${file}: ${Date.now() - started} ms\n`)
      if (error) reject(error)
      else resolve()
    }
    const abort = () => {
      signalChild(proc, 'SIGTERM')
      forced = setTimeout(() => signalChild(proc, 'SIGKILL'), killGraceMs)
      // Do not depend on close: a descendant can retain the inherited stderr pipe.
      deadline = setTimeout(() => finish(new Error('Cancelled')), killGraceMs + settleGraceMs)
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    proc.once('error', finish)
    proc.once('close', code => {
      if (signal?.aborted) finish(new Error('Cancelled'))
      else if (code !== 0) finish(Object.assign(new Error(`${file} exited ${code}${stderr.trim() ? `: ${stderr.trim().slice(-1500)}` : ''}`), { exitCode: code }))
      else finish()
    })
  })
}

// Site families serving the same worker under their own domain (the omsite tunnel adds a host per family).
export const WORKER_DOMAINS = Object.freeze(['omgithub.com', 'lolgames.net'])
// The pairing page must stay on the domain the visitor opened (a mirror page never sends people to omgithub.com).
// Only the same worker label on a known family domain is accepted; anything else keeps the provisioned origin.
export function requestWorkerOrigin(webUrl, host) {
  let base
  try { base = new URL(webUrl) } catch { return webUrl }
  const label = base.hostname.split('.')[0], requested = String(host || '').toLowerCase().replace(/:\d+$/, '')
  const match = WORKER_DOMAINS.find(domain => requested === `${label}.${domain}`)
  return match && base.protocol === 'https:' ? `https://${requested}` : base.origin
}

export function v2PairPage(origin, sessionID) {
  const session = v2SessionUrl(origin, sessionID)
  // OpenCode 2.2.2's web client persists its server registry in this key.
  // Redeem in the embedded origin so storage partitioning matches the chat.
  return `<!doctype html><meta name="viewport" content="width=device-width"><title>Connecting OpenCode</title>
    <p id="status" role="status">Connecting OpenCode…</p><button id="retry" hidden>Retry connection</button>
    <script>
    (async function connect() {
      const status = document.getElementById('status'), retry = document.getElementById('retry');
      retry.hidden = true; status.textContent = 'Connecting OpenCode…';
      try {
        const pairResponse = await fetch('/omgithub/pair', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
        if (!pairResponse.ok) throw new Error('Pairing unavailable');
        const { code } = await pairResponse.json();
        if (!/^[A-Za-z0-9_-]+$/.test(code || '')) throw new Error('Invalid pairing code');
        const response = await fetch('/auth/connect/' + encodeURIComponent(code), { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error('Pairing failed');
        const { token } = await response.json();
        if (typeof token !== 'string' || !token) throw new Error('Missing pairing token');
        const key = 'opencode.global.dat:server';
        let state = {}; try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
        if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
        const list = Array.isArray(state.list) ? state.list : [];
        state.list = list.filter(item => item?.http?.url !== location.origin && item?.url !== location.origin && item !== location.origin);
        state.list.push({ type: 'http', http: { url: location.origin, password: token } });
        localStorage.setItem(key, JSON.stringify(state));
        location.replace(${JSON.stringify(session)});
      } catch {
        status.textContent = 'Could not connect to OpenCode.';
        retry.hidden = false; retry.onclick = connect;
      }
    })();
    </script>`
}

async function serve() {
  const env = process.env, directory = env.OPENCODE_WEB_DIR
  recordChildren = () => {
    const path = join(directory, 'lifecycle-children.json')
    writeFileSync(`${path}.tmp`, JSON.stringify([...children].map(proc => proc.pid)))
    renameSync(`${path}.tmp`, path)
  }
  recordChildren()
  const upstream = `http://127.0.0.1:${env.OPENCODE_WEB_PORT}`
  const v2api = createV2Client({ base: upstream, password: env.OPENCODE_PASSWORD })
  const mainID = () => { try { return readFileSync(join(directory, 'checkpoint-session-id'), 'utf8').trim() } catch { return '' } }
  const lifecycle = new Lifecycle({
    save: async (signal, interrupted) => {
      if (!mainID()) return null
      await child(process.execPath, [join(env.RUNTIME_DIR, 'scripts/session-checkpoint.mjs'), interrupted ? 'shutdown' : 'save'], { signal })
      return JSON.parse(readFileSync(join(directory, 'checkpoint-state.json'), 'utf8'))
    },
    deploy: async ({ checkpoint, messageID, generation, signal }) => {
      const appURL = readFileSync(join(directory, 'app-url'), 'utf8').trim()
      if (!appURL) throw new Error('Preview failed: app tunnel unavailable')
      await child(process.execPath, [join(env.RUNTIME_DIR, 'scripts/session-deploy.mjs')], { signal, env: { ...env, APP_URL: appURL, CHECKPOINT_COMMIT: checkpoint.commit, CHECKPOINT_GENERATION: checkpoint.generation, MAIN_MESSAGE_ID: messageID, DEPLOYMENT_GENERATION: String(generation) } })
      writeFileSync(join(directory, 'runner-activity.json'), JSON.stringify({ at: Date.now() }))
    },
    awaiting: async ({ messageID }) => {
      const id = mainID()
      if (!id) return false
      const result = awaitingReply(await v2api.messages(id))
      if (!result.awaiting || (result.message_id && result.message_id !== messageID)) return false
      writeFileSync(join(directory, 'awaiting-reply.json'), JSON.stringify({ message_id: messageID, reason: result.reason, since: new Date().toISOString() }))
      process.stderr.write(`[awaiting-reply] ${messageID} asked a question without changing files; skipping delivery until a reply arrives.\n`)
      return true
    },
    status: async (state, generation, error = '') => {
      writeFileSync(join(directory, 'deployment-status.json'), JSON.stringify({ state, generation, error, message_id: lifecycle.lastMessage, updated_at: new Date().toISOString() }))
      if (state === 'working' && existsSync(join(directory, 'active-validation.json'))) {
        const active = JSON.parse(readFileSync(join(directory, 'active-validation.json'), 'utf8'))
        await v2api.interrupt(active.id)
        rmSync(join(directory, 'active-validation.json'), { force: true })
      }
      if (!lifecycle.stopping) {
        try {
        await registerDeployment(env, state, generation, error)
        await heartbeat()
        } catch (error) { process.stderr.write(`Status callback deferred: ${error.message}\n`) }
      }
    }
  })
  try { lifecycle.generation = Number(JSON.parse(readFileSync(join(directory, 'deployment-status.json'), 'utf8')).generation) || 0 } catch {}
  const bridge = new V2LifecycleBridge({ api: v2api, lifecycle, sessionID: '' })
  let messageGate = Promise.resolve()
  const proxy = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/omgithub/connect') {
        const origin = requestWorkerOrigin(readFileSync(join(directory, 'web-url'), 'utf8').trim(), req.headers.host)
        const page = v2PairPage(origin, mainID())
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(page)
        return
      }
      if (req.method === 'GET' && req.url === '/omgithub/pair') {
        const pair = await v2api.pair()
        if (!/^[A-Za-z0-9_-]+$/.test(pair.code || '')) throw new Error('Invalid pairing code')
        res.setHeader('content-type', 'application/json')
        res.setHeader('cache-control', 'no-store')
        res.end(JSON.stringify({ code: pair.code }))
        return
      }
      if (req.url === '/omgithub/heartbeat') { await heartbeat(); res.end('ok'); return }
      if (req.url === '/omgithub/reconcile') { await reconcile(); res.end('ok'); return }
      if (req.url === '/omgithub/deployment') { res.setHeader('content-type', 'application/json'); res.end(readFileSync(join(directory, 'deployment-status.json'), 'utf8')); return }
      if (isV2MainInterrupt(req.method, req.url, mainID())) { bridge.sessionID = mainID(); bridge.beforeInterrupt() }
      if (isV2MainPrompt(req.method, req.url, mainID())) {
        bridge.sessionID = mainID()
        const gate = messageGate.then(() => bridge.beforePrompt())
        messageGate = gate.catch(() => {})
        await gate
      }
      const targetURL = `${upstream}${req.url}`
      const target = httpRequest(targetURL, { method: req.method, headers: req.headers }, reply => {
        res.writeHead(reply.statusCode, reply.headers); reply.pipe(res)
      })
      target.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
      req.pipe(target)
    } catch { res.writeHead(503); res.end('Deployment controller unavailable') }
  })
  proxy.on('upgrade', (req, socket, head) => {
    const remote = connect(Number(env.OPENCODE_WEB_PORT), '127.0.0.1', () => {
      remote.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).map(([k,v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
      remote.write(head); socket.pipe(remote); remote.pipe(socket)
    })
    remote.on('error', () => socket.destroy()); socket.on('error', () => remote.destroy())
  })
  let registration = Promise.resolve()
  // Retry readiness every 2.5 s for up to 30 s per new set of unreachable URLs instead of waiting 30 s.
  const fast = { key: '', until: 0, timer: null }
  const retrySoon = pending => {
    const key = pending.join(' ')
    if (!key) { fast.key = ''; return }
    if (key !== fast.key) Object.assign(fast, { key, until: Date.now() + 30000 })
    if (fast.timer || Date.now() >= fast.until || lifecycle.stopping) return
    fast.timer = setTimeout(() => { fast.timer = null; void heartbeat() }, 2500)
  }
  const heartbeat = state => {
    registration = registration.then(async () => {
      const result = await registerRun(env, state)
      if (!state) retrySoon(result?.pending || [])
    }).catch(error => console.error(error.message))
    return registration
  }
  await new Promise(resolve => proxy.listen(Number(env.OPENCODE_CONTROL_PORT), '127.0.0.1', resolve))
  await heartbeat()
  const heartbeatTimer = setInterval(() => void heartbeat(), 30000)
  // Independent watchdog covers validation, preview holds and silent main processes.
  const startedAt = Number(env.JOB_STARTED_AT) * 1000 || Date.now()
  let lastWork = startedAt
  const deadlineTimer = setInterval(() => {
    try { lastWork = Math.max(lastWork, JSON.parse(readFileSync(join(directory, 'runner-activity.json'), 'utf8')).at || 0) } catch {}
    const reason = Date.now() - startedAt >= 18000000 ? 'five-hour limit' : Date.now() - lastWork >= 3600000 ? 'one hour idle' : null
    if (reason) {
      console.error(`Runner stopped: ${reason}`)
      writeFileSync(join(directory, 'runner-stop.json'), JSON.stringify({ reason }))
      process.kill(process.pid, 'SIGTERM')
    }
  }, 10000)
  let uploading = false
  const upload = async () => {
    if (uploading) return
    uploading = true
    try { await uploadScreenshots(env) } catch (error) { console.error('WIP upload deferred:', error.message) }
    finally { uploading = false }
  }
  const screenshotTimer = setInterval(() => void upload(), 2000)
  void upload()
  let stopping = false
  const events = new AbortController()
  for (const name of ['SIGTERM', 'SIGINT']) process.once(name, () => {
    stopping = true
    events.abort()
    proxy.close()
    proxy.closeAllConnections()
    clearInterval(heartbeatTimer)
    clearInterval(deadlineTimer)
    clearTimeout(fast.timer)
    clearInterval(screenshotTimer)
    // Leave room for worker drain, the 120-second upload, and an ended callback.
    const deadline = setTimeout(() => {
      console.error('Lifecycle shutdown exceeded 180000 ms; terminating owned child groups')
      terminateChildren(); writeFileSync(join(directory, 'lifecycle-shutdown.json'), JSON.stringify({ exitCode: 1 })); process.exit(1)
    }, 180000)
    void lifecycle.shutdown().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(async () => {
      try { await bounded(() => heartbeat('ended'), 15000, 'Shutdown ended callback') }
      catch (error) { console.error(error.message); process.exitCode = 1 }
      finally { clearTimeout(deadline); terminateChildren(); writeFileSync(join(directory, 'lifecycle-shutdown.json'), JSON.stringify({ exitCode: process.exitCode || 0 })); process.exit(process.exitCode || 0) }
    })
  })
  async function reconcile() {
    const id = mainID()
    if (!id || lifecycle.stopping) return
    bridge.sessionID = id; await bridge.reconcile()
  }
  // Reconnect the event stream, not a checkpoint timer. Reconcile missed idle
  // events after reconnecting so the first quick response is not lost.
  while (!stopping) {
    try {
      await reconcile()
      for await (const event of v2api.events({ signal: events.signal })) {
        if (event.type === 'server.connected') await reconcile()
        bridge.sessionID = mainID()
        if (bridge.sessionID) {
          // Only session work resets the idle deadline. Heartbeats and browser polls do not.
          const id = event.data?.sessionID || event.data?.info?.sessionID || event.data?.part?.sessionID
          if (id === bridge.sessionID && /^(session\.execution\.|message\.|part\.|tool\.)/.test(event.type)) {
            writeFileSync(join(directory, 'runner-activity.json'), JSON.stringify({ at: Date.now() }))
          }
          await bridge.observe(event)
        }
      }
    } catch (error) { if (!stopping) console.error(error.message) }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, 1000))
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await serve()
