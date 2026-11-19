// Install account provider credentials through the running OpenCode V2 API.
// Legacy auth.json import runs only during the first database migration, so a
// persistent runner database would otherwise ignore newly connected providers.
export function createProviderCredentialBridge({ env, request = fetch, remember = () => {} }) {
  async function call(path, method = 'GET', body) {
    if (!/^\d+$/.test(String(env.OPENCODE_WEB_PORT || '')) || !env.OPENCODE_PASSWORD) throw new Error('Provider credentials require the running V2 server')
    const response = await request('http://127.0.0.1:' + env.OPENCODE_WEB_PORT + '/api/credential' + path, {
      method, headers: { authorization: 'Basic ' + Buffer.from('opencode:' + env.OPENCODE_PASSWORD).toString('base64'), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) throw new Error('Provider credential ' + method + ' HTTP ' + response.status)
    return response.status === 204 ? null : response.json()
  }

  function methodID(integrationID) {
    if (integrationID === 'openai') return 'chatgpt-browser'
    if (['github-copilot', 'xai'].includes(integrationID)) return 'device'
    if (integrationID === 'gitlab') return 'pkce'
    if (['digitalocean', 'poe', 'snowflake-cortex'].includes(integrationID)) return 'browser'
    return 'oauth'
  }

  function valueFor(integrationID, raw) {
    if (!raw || typeof raw !== 'object') return null
    if (raw.type === 'api' && typeof raw.key === 'string' && raw.key) return { type: 'key', key: raw.key }
    if (raw.type === 'wellknown' && typeof raw.token === 'string' && raw.token) return { type: 'key', key: raw.token }
    if (raw.type !== 'oauth' || typeof raw.access !== 'string' || typeof raw.refresh !== 'string' || !Number.isSafeInteger(raw.expires)) return null
    const metadata = { ...(raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {}) }
    const accountID = raw.accountId || metadata.accountID
    if (accountID) metadata.accountID = String(accountID)
    return { type: 'oauth', methodID: methodID(integrationID), access: raw.access, refresh: raw.refresh, expires: raw.expires, ...(Object.keys(metadata).length ? { metadata } : {}) }
  }

  function same(a, b) {
    if (!a || !b || a.type !== b.type) return false
    return a.type === 'key' ? a.key === b.key : a.access === b.access && a.refresh === b.refresh
  }

  function authFor(integrationID, value) {
    if (!value || typeof value !== 'object') throw new Error('Invalid provider credential')
    if (value.type === 'key' && typeof value.key === 'string') return { type: 'api', key: value.key }
    if (value.type !== 'oauth' || typeof value.access !== 'string' || typeof value.refresh !== 'string' || !Number.isSafeInteger(value.expires)) throw new Error('Invalid provider OAuth credential')
    const out = { type: 'oauth', access: value.access, refresh: value.refresh, expires: value.expires }
    if (value.metadata && typeof value.metadata === 'object') {
      if (integrationID === 'openai' && value.metadata.accountID) out.accountId = value.metadata.accountID
      else out.metadata = value.metadata
    }
    return out
  }

  async function install(auth, { skip = new Set() } = {}) {
    const rows = (await call('')).data
    if (!Array.isArray(rows)) throw new Error('Invalid V2 credential list')
    const installed = {}
    for (const [integrationID, raw] of Object.entries(auth || {})) {
      if (skip.has(integrationID)) continue
      const value = valueFor(integrationID, raw)
      if (!value) continue
      const match = rows.find(row => row.integrationID === integrationID && same(row.value, value))
      if (match) {
        if (!match.active) await call('/' + encodeURIComponent(match.id) + '/activate', 'POST')
        remember(value)
        installed[integrationID] = match.id
        continue
      }
      const created = await call('', 'POST', { integrationID, label: 'OmGithub', value, activate: true })
      const id = created?.data?.id
      if (!id) throw new Error('Missing provider credential ID')
      // Remove only stale OmGithub credentials for this provider, never unrelated accounts.
      for (const row of rows) if (row.integrationID === integrationID && row.label === 'OmGithub' && row.id !== id) await call('/' + encodeURIComponent(row.id), 'DELETE')
      remember(value)
      installed[integrationID] = id
    }
    return installed
  }

  async function read(integrationID, id) {
    const rows = (await call('')).data
    if (!Array.isArray(rows)) throw new Error('Invalid V2 credential list')
    const row = rows.find(item => item.id === id && item.integrationID === integrationID)
    if (!row) throw new Error('Provider credential disappeared')
    remember(row.value)
    return authFor(integrationID, row.value)
  }

  const remove = id => call('/' + encodeURIComponent(id), 'DELETE')
  return { install, read, remove }
}
