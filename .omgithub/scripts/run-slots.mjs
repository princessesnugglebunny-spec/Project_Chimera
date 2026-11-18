import { pathToFileURL } from 'node:url'
// Keep the newest two execution jobs across every branch of this repository.
// Preparation-only runs do not displace work; the current approved run reserves a slot.
export async function enforceSlots({ repository, run, token, request = fetch, pause = ms => new Promise(r => setTimeout(r, ms)) }) {
  const api = async (path, method = 'GET') => {
    const response = await request(`https://api.github.com/repos/${repository}${path}`, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`Runner slots: GitHub HTTP ${response.status}`)
    return method === 'POST' || response.status === 204 ? null : response.json()
  }
  const candidates = []
  for (const status of ['in_progress', 'queued']) for (let page = 1; ; page++) {
    const rows = (await api(`/actions/workflows/opencode.yml/runs?status=${status}&per_page=100&page=${page}`)).workflow_runs || []
    for (const row of rows) {
      if (String(row.id) === String(run)) continue
      const jobs = (await api(`/actions/runs/${row.id}/jobs?per_page=100`)).jobs || []
      if (jobs.some(j => ['queued', 'in_progress', 'waiting', 'pending'].includes(j.status) && /(?:^|\/\s*)opencode$/.test(j.name))) candidates.push(row)
    }
    if (rows.length < 100) break
  }
  const unique = new Map(candidates.map(row => [String(row.id), row]))
  candidates.length = 0
  candidates.push(...unique.values(), { id: run })
  candidates.sort((a,b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1)
  const victims = candidates.slice(2)
  for (const row of victims) {
    await api(`/actions/runs/${row.id}/cancel`, 'POST')
    console.log(`Stopping older runner ${row.id}: two newer projects in this repository.`)
    // Cancellation is asynchronous. Do not launch a third execution before the old job ends.
    let stopped = false
    for (let n = 0; n < 60; n++) {
      if ((await api(`/actions/runs/${row.id}`)).status === 'completed') { stopped = true; break }
      await pause(2000)
    }
    if (!stopped) throw new Error('Older runner is still stopping. Retry after it ends.')
  }
  return victims.map(r => String(r.id))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await enforceSlots({ repository: process.env.GITHUB_REPOSITORY, run: process.env.GITHUB_RUN_ID, token: process.env.GH_TOKEN })
