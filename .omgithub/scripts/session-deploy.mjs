import { commitBuild } from './git-build.mjs'
import { createV2Client } from './opencode-v2-api.mjs'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { preparePreview, validateDeploymentOutput } from './preview-setup.mjs'
import { retry, uploadDeployment } from './deployment-retry.mjs'
import { child } from './session-lifecycle.mjs'
import projectLinks from './project-link.cjs'

const env = process.env
const evidence = join(env.RUNNER_TEMP, `validation-${env.CHECKPOINT_GENERATION}`)
const project = env.PROJECT_DIR
const base = `http://127.0.0.1:${env.OPENCODE_WEB_PORT}`
const v2api = createV2Client({ base, password: env.OPENCODE_PASSWORD })
const main = readFileSync(join(env.OPENCODE_WEB_DIR, 'checkpoint-session-id'), 'utf8').trim()
let fork
async function abort() { if (fork) await v2api.interrupt(fork.id) }
const controller = new AbortController()
async function command(file, args) {
  const started = Date.now()
  try { return (await promisify(execFile)(file, args, { signal: controller.signal, timeout: 120000, maxBuffer: 32 * 1024 * 1024 })).stdout.trim() }
  finally { console.error(`[timing] ${file}: ${Date.now() - started} ms`) }
}
for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { controller.abort(); void abort().catch(console.error) })
try {
  mkdirSync(evidence, { recursive: true })
  const runFork = async prompt => {
    if (!fork) {
      fork = await v2api.fork(main)
      if (!fork.id?.startsWith('ses_')) throw new Error('No repair fork created')
      writeFileSync(join(env.OPENCODE_WEB_DIR, 'active-validation.json'), JSON.stringify({ id: fork.id, directory: project }))
    }
    const connection = ['--server', base]
    await child(env.OPENCODE_BIN || join(env.HOME, '.opencode/bin/opencode'), ['run', '--auto', ...connection, '--session', fork.id, '--model', readFileSync(join(env.OPENCODE_WEB_DIR, 'main-model'), 'utf8').trim(), prompt], { signal: controller.signal, cwd: project })
  }
  const { repaired } = await preparePreview({ env, evidence, signal: controller.signal, repair: runFork })
  if (repaired) {
    await child(process.execPath, [join(env.RUNTIME_DIR, 'scripts/session-checkpoint.mjs'), 'save'], { signal: controller.signal })
    const updated = JSON.parse(readFileSync(join(env.OPENCODE_WEB_DIR, 'checkpoint-state.json'), 'utf8'))
    env.CHECKPOINT_COMMIT = updated.commit
    env.CHECKPOINT_GENERATION = updated.generation
  }
  const marker = join(env.OPENCODE_WEB_DIR, 'live-preview-url')
  let advertised = ''
  try { advertised = readFileSync(marker, 'utf8') } catch {}
  if (advertised !== env.APP_URL) {
    await child('gh', ['api', `repos/${env.GITHUB_REPOSITORY}/issues/${env.TRIGGER_ISSUE_NUMBER}/comments`, '-f', `body=Preview ready.\n\n${projectLinks.projectLink(env)}`], { signal: controller.signal })
    writeFileSync(marker, env.APP_URL)
  }
  const screenshots = readdirSync(evidence).filter(name => /^final-.*\.(png|jpe?g|webp)$/i.test(name))
  if (!['final-desktop.png', 'final-mobile.png'].every(name => screenshots.includes(name))) throw new Error('Capture produced no screenshots')
  const output = JSON.parse(readFileSync(join(env.OPENCODE_WEB_DIR, 'deployment-output.json'), 'utf8'))
  const deployDirectory = validateDeploymentOutput(project, output)
  const build = commitBuild({ root: env.GITHUB_WORKSPACE, directory: deployDirectory, temporary: env.RUNNER_TEMP,
    repository: env.GITHUB_REPOSITORY, issue: env.TRIGGER_ISSUE_NUMBER, run: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT || '1',
    generation: env.DEPLOYMENT_GENERATION, sourceCommit: env.CHECKPOINT_COMMIT })
  const hostedUrl = `https://f.ondev.store/${env.GITHUB_REPOSITORY}/blob/${build.build_commit}/`
  await retry(async () => {
    const ready = await fetch(hostedUrl + 'index.html', { method: 'HEAD', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
    if (!ready.ok) throw new Error(`Published build not ready: HTTP ${ready.status}`)
  }, { signal: controller.signal, attempts: 8 })
  const hostedEvidence = join(evidence, 'github-verification')
  await retry(() => child(process.execPath, [join(env.RUNTIME_DIR, 'scripts/default-capture.mjs')], { signal: controller.signal, cwd: project,
    env: { ...env, CAPTURE_URL: hostedUrl, CAPTURE_DIR: hostedEvidence, CAPTURE_STRICT: '1' } }),
    { signal: controller.signal, retryable: error => error.exitCode === 75 })
  if (controller.signal.aborted) throw new Error('Cancelled')
  const finalScreenshots = []
  for (const name of ['final-desktop.png', 'final-mobile.png']) {
    const uploaded = await retry(async () => {
      const response = await fetch(`${env.OMGITHUB_ORIGIN || 'https://omgithub.com'}/api/github/${env.GITHUB_REPOSITORY}/issues/${env.TRIGGER_ISSUE_NUMBER}/final-screenshots`, { method: 'POST', signal: controller.signal,
        headers: { authorization: `Bearer ${env.OMGITHUB_CALLBACK_TOKEN || ''}`, 'content-type': 'image/png', 'x-omgithub-run': env.GITHUB_RUN_ID, 'x-omgithub-attempt': env.GITHUB_RUN_ATTEMPT || '1', 'x-omgithub-name': name },
        body: readFileSync(join(hostedEvidence, name)) })
      if (!response.ok) throw Object.assign(new Error(`Final screenshot HTTP ${response.status}`), { transient: [408, 429, 500, 502, 503, 504].includes(response.status) })
      return response.json()
    }, { signal: controller.signal, retryable: error => error.transient === true })
    if (!/^https:\/\/[^/]+\/api\/final-screenshots\/[a-f0-9]{64}$/.test(uploaded.url || '')) throw new Error('Invalid final screenshot response')
    finalScreenshots.push(uploaded.url)
  }
  const site = env.OMGITHUB_ORIGIN || 'https://omgithub.com'
  const deployed = await uploadDeployment(`${site}/api/github/${env.GITHUB_REPOSITORY}/issues/${env.TRIGGER_ISSUE_NUMBER}/deployment`, { method: 'POST', headers: {
    authorization: `Bearer ${env.OMGITHUB_CALLBACK_TOKEN || ''}`, 'content-type': 'application/json', 'x-omgithub-run': env.GITHUB_RUN_ID, 'x-omgithub-attempt': env.GITHUB_RUN_ATTEMPT || '1',
    'x-omgithub-generation': env.DEPLOYMENT_GENERATION, 'x-omgithub-commit': env.CHECKPOINT_COMMIT
  }, body: JSON.stringify({ build_commit: build.build_commit, screenshots: finalScreenshots }), signal: controller.signal })
  if (controller.signal.aborted) throw new Error('Cancelled')
  writeFileSync(join(env.OPENCODE_WEB_DIR, 'deployment-result.json'), JSON.stringify({ ...deployed, generation: env.DEPLOYMENT_GENERATION, sync: 'pending' }))
  try {
    await retry(async () => {
      const reportFile = join(env.OPENCODE_WEB_DIR, 'deployment-comment-id')
      let commentId = ''
      try { commentId = readFileSync(reportFile, 'utf8').trim() } catch {}
      const report = `Deployment ready.\n\n${projectLinks.projectLink(env)}`
      const result = JSON.parse(await command('gh', ['api', commentId ? `repos/${env.GITHUB_REPOSITORY}/issues/comments/${commentId}` : `repos/${env.GITHUB_REPOSITORY}/issues/${env.TRIGGER_ISSUE_NUMBER}/comments`, '-X', commentId ? 'PATCH' : 'POST', '-f', `body=${report}`]))
      writeFileSync(reportFile, String(result.id))
    }, { signal: controller.signal })
    writeFileSync(join(env.OPENCODE_WEB_DIR, 'deployment-result.json'), JSON.stringify({ ...deployed, generation: env.DEPLOYMENT_GENERATION, sync: 'ready' }))
  } catch (error) {
    if (controller.signal.aborted) throw error
    console.error('Result reporting failed:', error.message)
    writeFileSync(join(env.OPENCODE_WEB_DIR, 'deployment-result.json'), JSON.stringify({ ...deployed, generation: env.DEPLOYMENT_GENERATION, sync: 'failed', sync_error: error.message }))
  }
  if (JSON.parse(readFileSync(join(env.OPENCODE_WEB_DIR, 'deployment-result.json'), 'utf8')).sync === 'ready') rmSync(evidence, { recursive: true, force: true })
} finally {
  await abort().catch(error => console.error(error.message))
  rmSync(join(env.OPENCODE_WEB_DIR, 'active-validation.json'), { force: true })
}
