// Preserve Console workspace metadata through the native V2 credential API.
export function createConsoleCredentialBridge({ env, request = fetch, remember = () => {} }) {
  async function call(path, method = 'GET', body) {
    if (!/^\d+$/.test(String(env.OPENCODE_WEB_PORT || '')) || !env.OPENCODE_PASSWORD) throw new Error('OpenCode Console requires the running V2 server')
    const response = await request(`http://127.0.0.1:${env.OPENCODE_WEB_PORT}/api/credential${path}`, {
      method, headers: { authorization: `Basic ${Buffer.from(`opencode:${env.OPENCODE_PASSWORD}`).toString('base64')}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000)
    })
    if (!response.ok) throw new Error(`Console credential ${method} HTTP ${response.status}`)
    return response.status === 204 ? null : response.json()
  }
  async function install(auth) {
    const value = auth?.opencode
    if (value?.type !== 'oauth' || !value.metadata?.orgID) return null
    const rows = (await call('')).data
    if (!Array.isArray(rows)) throw new Error('Invalid V2 credential list')
    const created = await call('', 'POST', { integrationID: 'opencode', label: 'OmGithub Console', value: { type: 'oauth', methodID: 'device', access: value.access, refresh: value.refresh, expires: value.expires, metadata: value.metadata } })
    if (!created?.data?.id) throw new Error('Missing Console credential ID')
    // Remove only the legacy duplicate imported from this run's own auth.json.
    for (const row of rows) if (row.integrationID === 'opencode' && row.value?.access === value.access && row.id !== created.data.id) await call(`/${encodeURIComponent(row.id)}`, 'DELETE')
    remember(created.data.value)
    return created.data.id
  }
  async function read(id) {
    const rows = (await call('')).data
    const row = rows?.find(row => row.id === id && row.integrationID === 'opencode')
    if (!row || row.value?.type !== 'oauth' || !row.value.metadata?.orgID) throw new Error('Console credential disappeared; reconnect in Settings')
    remember(row.value)
    const { methodID, ...value } = row.value
    return value
  }
  const remove = id => call(`/${encodeURIComponent(id)}`, 'DELETE')
  return { install, read, remove }
}
