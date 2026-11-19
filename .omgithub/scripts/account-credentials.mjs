import { createConsoleCredentialBridge } from './console-credentials.mjs'
import { createProviderCredentialBridge } from './provider-credentials.mjs'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const leaves = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(leaves) : []
export const escapeCommand = value => String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
export function writeEnv(file, name, value) {
  let delimiter
  do { delimiter = `omgithub_${randomUUID()}` } while (String(value).split(/\r?\n/).includes(delimiter))
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`)
}
export function credentialWorkSettled(env) {
  const directory = env.OPENCODE_WEB_DIR
  if (!directory) return true
  if (existsSync(join(directory, 'active-validation.json'))) return false
  if (!existsSync(join(directory, 'main-model'))) return true
  if (!existsSync(join(directory, 'opencode-run.exit'))) return false
  try { return ['ready', 'failed'].includes(JSON.parse(readFileSync(join(directory, 'deployment-status.json'), 'utf8')).state) }
  catch { return true }
}
export function createCredentialClient({ env = process.env, request = fetch, mask = value => console.log(`::add-mask::${escapeCommand(value)}`) } = {}) {
  const origin = (env.OMGITHUB_ORIGIN || 'https://omgithub.com').replace(/\/$/, '')
  const directory = join(env.RUNNER_TEMP, 'omgithub-account-credentials')
  const stateFile = join(directory, 'state.json'), secretFile = join(directory, 'values.json'), mcpFile = join(directory, 'mcp.json')
  const authFile = join(env.XDG_DATA_HOME || join(env.HOME, '.local/share'), 'opencode/auth.json')
  const save = (file, value) => { mkdirSync(dirname(file), { recursive: true, mode: 0o700 }); const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 }); renameSync(tmp, file) }
  function remember(value) {
    const values = existsSync(secretFile) ? JSON.parse(readFileSync(secretFile, 'utf8')) : []
    for (const item of leaves(value)) if (item && !values.includes(item)) { mask(item); values.push(item) }
    save(secretFile, values)
  }
  const consoleBridge = createConsoleCredentialBridge({ env, request, remember })
  const providerBridge = createProviderCredentialBridge({ env, request, remember })
  async function installConsole() {
    if (!existsSync(stateFile)) return
    const state = JSON.parse(readFileSync(stateFile, 'utf8'))
    if (!(state.imported || []).length) return
    if (!state.consoleCredential && (state.imported || []).includes('opencode')) {
      const id = await consoleBridge.install(state.auth)
      if (id) state.consoleCredential = id
    }
    const installed = await providerBridge.install(state.auth, { skip: new Set(['opencode']) })
    state.providerCredentials = { ...(state.providerCredentials || {}), ...installed }
    save(stateFile, state)
  }
  async function call(body) {
    const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL); url.searchParams.set('audience', origin)
    const identity = await request(url, { headers: { authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }, signal: AbortSignal.timeout(15000) })
    if (!identity.ok) throw new Error(`Workflow identity HTTP ${identity.status}`)
    const { value } = await identity.json()
    const response = await request(`${origin}/api/github/${env.GITHUB_REPOSITORY}/issues/${env.TRIGGER_ISSUE_NUMBER}/credentials`, {
      method: 'POST', headers: { authorization: `Bearer ${value}`, 'content-type': 'application/json' },
      body: JSON.stringify({ run: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, ...body }), signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) throw Object.assign(new Error(`Account credentials HTTP ${response.status}`), { status: response.status })
    return response.json()
  }
  async function load() {
    const data = await call({ use_auth: true })
    if (data.fusion_required === true && (data.fusion_route !== 'shared' || !data.secrets?.FUSION_ACCESS_TOKEN)) throw new Error('Required shared Fusion unavailable; refusing free-model fallback')
    writeEnv(env.GITHUB_ENV, 'FUSION_ROUTE', ['own', 'shared', 'none'].includes(data.fusion_route) ? data.fusion_route : 'none')
    writeEnv(env.GITHUB_ENV, 'FUSION_REQUIRE_SHARED', data.fusion_required === true ? 'true' : 'false')
    writeEnv(env.GITHUB_ENV, 'FUSION_FORCE_SHARED_TEST', data.fusion_force_test === true ? 'true' : 'false')
    if (data.debug_ssh_public_key && !env.AGENTSWEB_SSH_PUBLIC_KEY) {
      if (!/^ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]+)?$/.test(data.debug_ssh_public_key)) throw new Error('Invalid debug public key')
      writeEnv(env.GITHUB_ENV, 'AGENTSWEB_SSH_PUBLIC_KEY', data.debug_ssh_public_key)
      writeEnv(env.GITHUB_ENV, 'AGENTSWEB_SSH_ENABLED', 'true')
    }
    const mcp = data.mcp || {}
    if (Object.keys(mcp).length) {
      remember(Object.values(mcp).map(server => server.headers))
      let configured = {}
      if (env.OPENCODE_CONFIG_CONTENT) {
        try { configured = JSON.parse(env.OPENCODE_CONFIG_CONTENT) } catch { throw new Error('Enter valid JSON in OPENCODE_CONFIG_CONTENT before adding account MCP servers') }
      }
      // Keep explicit workflow entries; account servers use an account_ prefix.
      const content = JSON.stringify({ ...configured, mcp: { ...mcp, ...configured.mcp } })
      writeEnv(env.GITHUB_ENV, 'OPENCODE_CONFIG_CONTENT', content)
      save(mcpFile, { names: Object.keys(mcp) })
    }
    const providers = data.providers || {}
    if (Object.keys(providers).length) {
      let configured = {}
      if (env.OPENCODE_CONFIG_CONTENT) {
        try { configured = JSON.parse(env.OPENCODE_CONFIG_CONTENT) } catch { throw new Error('Enter valid JSON in OPENCODE_CONFIG_CONTENT before adding custom providers') }
      }
      // Explicit workflow entries win; account custom endpoints fill in the rest.
      const content = JSON.stringify({ ...configured, providers: { ...providers, ...configured.providers } })
      writeEnv(env.GITHUB_ENV, 'OPENCODE_CONFIG_CONTENT', content)
    }
    // Site-wide backup endpoint: the last link in the model chain, never routed through WARP.
    if (typeof data.backup_model === 'string' && /^[\w.-]+\/[\w./:-]+$/.test(data.backup_model)) {
      writeEnv(env.GITHUB_ENV, 'OMG_BACKUP_MODEL', data.backup_model)
      const host = typeof data.backup_host === 'string' ? data.backup_host.trim() : ''
      if (/^[a-z0-9.-]+$/i.test(host)) {
        writeEnv(env.GITHUB_ENV, 'OMG_BACKUP_HOST', host)
        // The web directory may not exist yet; the env var alone is enough for the serve step.
        try { mkdirSync(env.OPENCODE_WEB_DIR, { recursive: true, mode: 0o700 }); writeFileSync(join(env.OPENCODE_WEB_DIR, 'backup-host'), host + '\n', { mode: 0o600 }) } catch { /* keep OMG_BACKUP_HOST */ }
      }
    }
    remember(data.secrets)
    const names = []
    for (const [name, value] of Object.entries(data.secrets || {})) {
      if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(name) || typeof value !== 'string') throw new Error('Invalid account secret payload')
      // Explicit workflow/repository environment values take precedence.
      if (env[name] && !(data.fusion_required === true && ['FUSION_ACCESS_TOKEN', 'FUSION_UPSTREAM'].includes(name))) continue
      writeEnv(env.GITHUB_ENV, name, value); names.push(name)
    }
    let repositoryAuth = {}
    if (env.OPENCODE_AUTH_CONTENT) {
      try { repositoryAuth = JSON.parse(env.OPENCODE_AUTH_CONTENT) } catch { throw new Error('Enter valid JSON in OPENCODE_AUTH_CONTENT') }
    }
    const imported = Object.keys(data.auth || {}).filter(provider => !Object.hasOwn(repositoryAuth, provider))
    if (imported.length) {
      const merged = { ...data.auth, ...repositoryAuth }
      remember(merged)
      save(authFile, merged)
      save(stateFile, { revision: data.revision, auth: data.auth, imported })
      // OpenCode gives inline auth absolute precedence over auth.json.
      // Use the merged file so OAuth refreshes remain visible to synchronization.
      writeEnv(env.GITHUB_ENV, 'OPENCODE_AUTH_CONTENT', '')
      writeEnv(env.GITHUB_ENV, 'OMGITHUB_ACCOUNT_AUTH_FILE', authFile)
    }
    writeEnv(env.GITHUB_ENV, 'OMGITHUB_SECRET_VALUES_FILE', secretFile)
    return { customSecrets: names.length, accountAuth: Boolean(imported.length) }
  }
  async function sync(release = false) {
    if (release && existsSync(mcpFile)) {
      await call({ operation: 'release_mcp' })
      rmSync(mcpFile, { force: true })
    }
    if (!existsSync(stateFile)) {
      if (release && env.OMGITHUB_ACCOUNT_AUTH_FILE === authFile) rmSync(authFile, { force: true })
      return
    }
    const state = JSON.parse(readFileSync(stateFile, 'utf8'))
    if (state.syncStopped) {
      if (release) {
        await consoleBridge.remove(state.consoleCredential)
        for (const id of Object.values(state.providerCredentials || {})) await providerBridge.remove(id).catch(() => {})
        rmSync(stateFile, { force: true }); rmSync(authFile, { force: true })
      }
      return
    }
    const auth = JSON.parse(readFileSync(authFile, 'utf8'))
    if (state.consoleCredential) auth.opencode = await consoleBridge.read(state.consoleCredential)
    for (const [integrationID, id] of Object.entries(state.providerCredentials || {})) {
      try { auth[integrationID] = await providerBridge.read(integrationID, id) }
      catch { /* The server may have rotated or removed it; keep the last account copy. */ }
    }
    // Only return the providers actually checked out from this account.
    const imported = new Set(state.imported || Object.keys(state.auth))
    const selected = Object.fromEntries(Object.keys(state.auth).map(key => [key, imported.has(key) ? auth[key] : state.auth[key]]))
    remember(selected)
    const changed = JSON.stringify(selected) !== JSON.stringify(state.auth)
    try {
      const data = await call({ operation: 'refresh', revision: state.revision, ...(changed ? { auth: selected } : {}), release })
      save(stateFile, { revision: data.revision, auth: selected, imported: [...imported], ...(state.consoleCredential ? { consoleCredential: state.consoleCredential } : {}), ...(Object.keys(state.providerCredentials || {}).length ? { providerCredentials: state.providerCredentials } : {}) })
    } catch (error) {
      if (error.status === 409) {
        if (state.consoleCredential && !release) save(stateFile, { ...state, syncStopped: true })
        else rmSync(stateFile, { force: true })
        console.log('Account credentials changed; retained the newer account version.'); return }
      throw error
    } finally {
      if (release) {
        if (state.consoleCredential) await consoleBridge.remove(state.consoleCredential)
        for (const id of Object.values(state.providerCredentials || {})) await providerBridge.remove(id).catch(() => {})
        rmSync(stateFile, { force: true }); rmSync(authFile, { force: true })
      }
    }
  }
  return { load, sync, installConsole, stateFile, mcpFile }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = createCredentialClient(), mode = process.argv[2] || 'load'
  if (mode === 'load') {
    const result = await client.load()
    console.log(`Loaded ${result.customSecrets} account secret(s); subscription auth: ${result.accountAuth ? 'account' : 'repository/default'}.`)
  } else if (mode === 'install-console') await client.installConsole()
  else if (mode === 'watch') {
    while (existsSync(client.stateFile)) {
      await new Promise(resolve => setTimeout(resolve, 60000))
      try { await client.sync() } catch { console.log('Account auth sync unavailable; retrying in one minute.') }
    }
  } else if (mode === 'finish') {
    const deadline = Date.now() + 15 * 60000
    while ((existsSync(client.stateFile) || existsSync(client.mcpFile)) && !credentialWorkSettled(process.env)) {
      if (Date.now() >= deadline) throw new Error('Credential release is waiting for validation to finish.')
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
    // Stop the refresher only after any repair/validation model work settles.
    const pidFile = join(process.env.RUNNER_TEMP, 'omgithub-account-auth-sync.pid')
    if (existsSync(pidFile)) { try { process.kill(Number(readFileSync(pidFile, 'utf8').trim()), 'SIGTERM') } catch {} }
    await client.sync(true)
  } else if (mode === 'release') await client.sync(true)
  else throw new Error('Unknown credentials operation')
}
