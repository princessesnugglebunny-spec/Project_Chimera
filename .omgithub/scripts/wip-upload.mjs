import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import captures from './wip-screenshots.cjs'

export async function uploadScreenshots(env, request = fetch) {
  const web = captures.webDirectory(env)
  if (!web || !env.OMGITHUB_CALLBACK_TOKEN) return
  const dir = join(web, 'wip-queue')
  let names
  try { names = readdirSync(dir).filter(name => /^[a-f0-9]{64}\.json$/.test(name)) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  const items = names.map(name => ({ name, meta: JSON.parse(readFileSync(join(dir, name), 'utf8')) })).sort((a, b) => a.meta.captured_at - b.meta.captured_at)
  for (const { name, meta } of items.slice(0, 8)) {
    const response = await request(`${env.OMGITHUB_ORIGIN || 'https://omgithub.com'}/api/github/${env.GITHUB_REPOSITORY}/issues/${env.TRIGGER_ISSUE_NUMBER}/progress-screenshots`, {
      method: 'POST', headers: { authorization: `Bearer ${env.OMGITHUB_CALLBACK_TOKEN}`, 'content-type': meta.type,
        'x-omgithub-run': env.GITHUB_RUN_ID, 'x-omgithub-attempt': env.GITHUB_RUN_ATTEMPT || '1',
        'x-omgithub-captured-at': String(meta.captured_at), 'x-omgithub-page-url': encodeURIComponent(meta.page_url),
        'x-omgithub-session': meta.session_id || '', 'x-omgithub-browser-session': encodeURIComponent(meta.browser_session || '') },
      body: readFileSync(join(dir, `${meta.hash}.image`)), signal: AbortSignal.timeout(15000)
    })
    if (!response.ok && response.status !== 409) throw new Error(`WIP upload HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
    writeFileSync(join(dir, `${meta.hash}.done`), response.ok ? 'uploaded' : 'superseded')
    rmSync(join(dir, name), { force: true }); rmSync(join(dir, `${meta.hash}.image`), { force: true })
  }
}
