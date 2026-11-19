export function parseIssueRequest(issue, defaultBranch = 'main') {
  const body = String(issue?.body || '')
  const title = String(issue?.title || '').trim()
  let metadata = {}
  try { metadata = JSON.parse(body.match(/<!-- omgithub-request:v1 (\{[^\n]*\}) -->/)?.[1] || '{}') } catch {}
  // The admin model list is the run order; model_chain is the older single-model-id form.
  const modelList = parseModelList(metadata.model_list)
  const modelChain = parseModelChain(metadata.model_chain)
  const requestBody = body.replace(/<!-- omgithub-request:v1 \{[^\n]*\} -->/g, '').trim()
  const requestTitle = title
  if (typeof metadata.branch !== 'string') return { request: requestBody || title, title, targetRef: defaultBranch, branchSpecified: false, branchError: '', modelChain, ...(modelList ? { modelList } : {}) }
  const targetRef = metadata.branch.trim()
  const invalid = !targetRef || targetRef.length > 255 || targetRef === '@' || targetRef.startsWith('-') ||
    targetRef.startsWith('/') || targetRef.endsWith('/') || targetRef.endsWith('.') || targetRef.endsWith('.lock') ||
    targetRef.includes('..') || targetRef.includes('@{') || targetRef.includes('//') ||
    targetRef.split('/').some(part => part.startsWith('.')) || /[\u0000-\u0020\u007f~^:?*[\]\\]/.test(targetRef)
  return {
    request: requestBody || requestTitle,
    title: requestTitle,
    targetRef: invalid ? defaultBranch : targetRef,
    branchSpecified: true,
    branchError: invalid ? 'Invalid branch metadata.' : '',
    modelChain,
    ...(modelList ? { modelList } : {})
  }
}

const MODEL_ID_PATTERN = /^[\w.-]+\/[\w./:-]+$/
const MAX_CHAIN_LENGTH = 20
const MAX_MODEL_LIST = 20
const MODEL_ROUTES = ['direct', 'warp', 'backup', 'api']

export function parseModelChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return null
  const validated = chain
    .slice(0, MAX_CHAIN_LENGTH)
    .filter(id => typeof id === 'string' && MODEL_ID_PATTERN.test(id))
  return validated.length > 0 ? validated : null
}

// The server writes the resolved admin model list into the issue body and the installed runner
// reads it back through this one parser, so the two copies cannot drift apart again.
export function parseModelList(list) {
  if (!Array.isArray(list) || list.length === 0) return null
  const rows = []
  for (const row of list.slice(0, MAX_MODEL_LIST)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(id)) continue
    if (typeof row.model !== 'string' || !MODEL_ID_PATTERN.test(row.model)) continue
    if (!MODEL_ROUTES.includes(row.route)) continue
    const entry = { id, model: row.model, route: row.route }
    if (typeof row.label === 'string' && row.label.trim()) entry.label = row.label.trim().slice(0, 120)
    if (typeof row.provider === 'string' && row.provider.trim()) entry.provider = row.provider.trim().slice(0, 100)
    if (typeof row.gate === 'string' && row.gate.trim()) entry.gate = row.gate.trim().slice(0, 40)
    rows.push(entry)
  }
  return rows.length > 0 ? rows : null
}
