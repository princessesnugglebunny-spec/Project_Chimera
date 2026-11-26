import { readyPublicUrls } from './public-readiness.mjs'
import { buildStats } from './build-stats.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let lastSequence = 1

export async function registerRun(env, state, check) {
  const directory = env.OPENCODE_WEB_DIR
  const read = name => { try { return readFileSync(join(directory, name), 'utf8').trim() } catch (error) { if (error.code === 'ENOENT') return ''; throw error } }
  const web = read('web-url'), preview = read('ready-preview-url'), session = read('checkpoint-session-id')
  const body = { run: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT || 1), sequence: (lastSequence = Math.max(Date.now(), lastSequence + 1)),
    state: state || (session && web ? 'live' : 'starting'), session_id: session,
    urls: { opencode: session && web ? `${web}/omgithub/connect` : '',
      files: read('files-url'), preview,
      branch: `https://github.com/${env.GITHUB_REPOSITORY}/tree/opencode-checkpoints/${env.TRIGGER_ISSUE_NUMBER}` } }
  Object.assign(body, buildStats(directory))
  const resume = read('resume-status.json')
  if (resume) { const status = JSON.parse(resume).status; if (['fresh', 'restored'].includes(status)) body.resume_status = status }
  const expected = body.urls
  body.urls = await readyPublicUrls(body.urls, check)
  if (body.state === 'live' && !body.urls.opencode) body.state = 'starting'
  // Brand-new tunnels often fail their first public check; report which URLs to retry soon.
  const pending = ['opencode', 'files', 'preview'].filter(key => expected[key] && !body.urls[key])
  if (pending.length) console.error(`[readiness] not publicly reachable yet: ${pending.map(key => `${key}=${new URL(expected[key]).host}`).join(', ')}`)
  const response = await fetch(`${env.OMGITHUB_ORIGIN || 'https://omgithub.com'}/api/github/${env.GITHUB_REPOSITORY}/issues/${env.TRIGGER_ISSUE_NUMBER}/run`, {
    method: 'POST', headers: { authorization: `Bearer ${env.OMGITHUB_CALLBACK_TOKEN || ''}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new Error(`Run registration HTTP ${response.status}`)
  return { state: body.state, pending: pending.map(key => expected[key]) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await registerRun(process.env, process.argv[2])
