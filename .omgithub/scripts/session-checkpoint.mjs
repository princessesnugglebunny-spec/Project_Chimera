import { normalizeV2Version, validateV2Session } from './opencode-v2-api.mjs'
import { isDeepStrictEqual } from 'node:util'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, existsSync, openSync, closeSync, readFileSync, rmSync, writeFileSync, lstatSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const env = process.env
const digest = value => createHash('sha256').update(value).digest('hex')
export function command(file, args, options = {}) {
  const start = Date.now()
  try { return (execFileSync(file, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'], ...options }) || '').trim() }
  catch (error) {
    const secrets = Object.entries(env).filter(([key]) => /TOKEN|SECRET|PASSWORD|API_KEY|AUTH_CONTENT|PRIVATE_KEY/.test(key)).map(([, value]) => value)
    const detail = redactSession(String(error.stderr || '').trim(), secrets).slice(-2000)
    throw Object.assign(new Error(`${file} ${args[0] || ''} failed (exit ${error.status ?? 'timeout'}).${detail ? `\n${detail}` : ''}`), { status: Number(String(error.stderr || '').match(/(?:HTTP |error: )(\d{3})/)?.[1]) || undefined })
  }
  finally { process.stderr.write(`[timing] ${file} ${args[0] || ''}: ${Date.now() - start} ms\n`) }
}
// OpenCode can exit before a piped stdout buffer drains. A regular file descriptor
// makes large JSON exports synchronous at the CLI boundary instead of truncating them.
export function exportSession(binary, sessionId, cwd, temporaryDirectory, version, standalone = false) {
  const file = join(temporaryDirectory, `session-export-${randomUUID()}.json`)
  const fd = openSync(file, 'wx', 0o600)
  try {
    const args = ['session', 'export', sessionId, ...(standalone ? ['--standalone'] : ['--server', `http://127.0.0.1:${env.OPENCODE_WEB_PORT}`])]
    command(binary, args, { cwd, stdio: ['ignore', fd, 'pipe'] })
    return JSON.parse(readFileSync(file, 'utf8'))
  } finally { closeSync(fd); rmSync(file, { force: true }) }
}

export function parseResume(request) {
  const matches = [...String(request).matchAll(/<!-- omgithub-resume:v1 (\{[^\n]*\}) -->/g)]
  if (!matches.length) {
    if (/<!--\s*omgithub-resume:/i.test(request)) throw new Error('Invalid resume request.')
    return null
  }
  if (matches.length !== 1) throw new Error('Ambiguous resume request.')
  const source = JSON.parse(matches[0][1])
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.source_repository) || !Number.isSafeInteger(source.source_issue) || source.source_issue < 1 ||
      !new RegExp(`^opencode-checkpoint-${source.source_issue}(?:-[1-9]\\d*-\\d+)?$`).test(source.checkpoint_tag)) throw new Error('Invalid checkpoint source.')
  if (typeof source.user_prompt === 'string') return { ...source, prompt: source.user_prompt }
  return { ...source, prompt: String(request).replace(matches[0][0], '').replace(/<!-- omgithub-resume-request:[a-f0-9]+ -->/g, '').replace(/^Continue from https:\/\/github\.com\/[^\n]+\n?/gm, '').trim() }
}
export function normalizedVersion(output) {
  return normalizeV2Version(output)
}
export function validTranscript(session, version) {
  if (!/^2\./.test(version)) return false
  try { validateV2Session(session); return true } catch { return false }
}
export function validateCheckpoint(c, source) {
  if (!(c?.version === 2 && c.repository?.toLowerCase() === source.source_repository.toLowerCase() && c.issue_number === source.source_issue &&
      Number.isSafeInteger(c.run_id) && c.run_id > 0 && /^[a-f0-9]{40}$/.test(c.commit) && /^opencode-checkpoints\/[1-9]\d*$/.test(c.branch) &&
      typeof c.project_dir === 'string' && !c.project_dir.startsWith('/') && !c.project_dir.includes('\\') && !/[\r\n\0]/.test(c.project_dir) && !c.project_dir.split('/').includes('..') &&
      (c.code_only === true || /^2\.\d+\.\d+$/.test(c.opencode_version)) && c.public_history === true && (c.code_only === true || /^ses_[a-zA-Z0-9]+$/.test(c.session?.info?.id || '') && validTranscript(c.session, c.opencode_version)))) throw new Error('No complete saved session is available.')
  if (c.session?.info?.parentID || c.session?.info?.fork) throw new Error('This checkpoint contains a verification fork. Select an earlier main-session checkpoint or start a new build.')
  return c
}
export function portableSession(value) { return structuredClone(value) }

export function redactSession(session, secrets = []) {
  function clean(value) {
    if (typeof value === 'string') {
      for (const secret of secrets.filter(s => typeof s === 'string' && s.length >= 8)) value = value.split(secret).join('[credential removed]')
      return value.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[private key removed]')
        .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, '[credential removed]')
    }
    if (Array.isArray(value)) return value.map(clean)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /^(?:apiKey|api_key|access_token|refresh_token|password|authorization)$/i.test(k) ? '[credential removed]' : clean(v)]))
    return value
  }
  return clean(session)
}
const forbidden = /(^|\/)(?:\.env(?:\.[^/]*)?|auth\.json|credentials(?:\.json)?|node_modules|screenshots|\.playwright-cli|\.git|\.agents|\.agentsweb|\.omgithub-runtime|\.opencode-ssh|\.opencode-web|opencode-agentsweb-id_ed25519(?:\.pub)?)(\/|$)|(?:\.log|\.pid|\.pem|\.key)$/i
export function excludedPath(path) { return path === '.omgithub' || path.startsWith('.omgithub/') || forbidden.test(path) || /(^|\/)\.opencode\/(?:goals|auth\.json)(\/|$)/.test(path) }

// Snapshot game edits, not listener changes. A new branch is compared with the
// current default branch by GitHub, which may have advanced since checkout.
export function retainWorkflowTree(git, baseline) {
  const staged = git('ls-files', '-z', '--', '.github/workflows').split('\0').filter(Boolean)
  if (staged.length) git('update-index', '--force-remove', '-z', '--stdin', { input: staged.join('\0') + '\0' })
  const entries = git('ls-tree', '-r', '-z', baseline, '--', '.github/workflows')
  if (entries) git('update-index', '-z', '--index-info', { input: entries.endsWith('\0') ? entries : entries + '\0' })
}

function checkpointPath() { return join(env.RUNNER_TEMP, 'omgithub-restore-checkpoint.json') }
function setEnv(name, value) {
  const delimiter = `OMGHITHUB_${randomUUID().replaceAll('-', '')}`
  appendFileSync(env.GITHUB_ENV, `${name}<<${delimiter}\n${value}\n${delimiter}\n`)
}
export function usesImportedSnapshot(source, checkpoint, runtime = env) {
  if (!runtime.SNAPSHOT_SOURCE_REPOSITORY && !runtime.SNAPSHOT_SOURCE_COMMIT) return false
  if (runtime.SNAPSHOT_SOURCE_REPOSITORY?.toLowerCase() !== source.source_repository.toLowerCase() || runtime.SNAPSHOT_SOURCE_COMMIT !== checkpoint.commit) throw new Error('Imported snapshot does not match the saved checkpoint.')
  return true
}
export function prepare() {
  const source = parseResume(env.COMMENT_BODY || '')
  if (!source) return
  if (!source.prompt.trim()) throw new Error('Enter the next game change.')
  if (!/^[a-f0-9]{40}$/.test(source.source_commit || '')) throw new Error('A pinned source commit is required.')
  const download = join(env.RUNNER_TEMP, `checkpoint-download-${randomUUID()}.json`)
  let payload
  const raw = `https://raw.githubusercontent.com/${source.source_repository}/${source.source_commit}`
  try {
    const status = command('curl', ['--silent', '--show-error', '--location', '--max-time', '120', '--output', download, '--write-out', '%{http_code}', `${raw}/.omgithub/checkpoint.json`])
    if (status === '404') payload = { version: 2, repository: source.source_repository, issue_number: source.source_issue, run_id: 1, branch: `opencode-checkpoints/${source.source_issue}`, project_dir: '', opencode_version: null, public_history: true, conversation_status: 'missing' }
    else if (status === '200') payload = JSON.parse(readFileSync(download, 'utf8'))
    else throw new Error(`GitHub checkpoint read failed (${status}).`)
    payload.commit = source.source_commit
    payload.import_history = source.import_history === true
    payload.code_only = !payload.import_history || payload.conversation_status !== 'saved'
    if (!payload.code_only) {
      try {
        command('curl', ['--fail', '--silent', '--show-error', '--max-filesize', '100000000', '--max-time', '120', '--output', download, `${raw}/.omgithub/conversation.json`])
        const bytes = readFileSync(download)
        if (digest(bytes) !== payload.session_sha256) throw new Error('Conversation digest mismatch')
        payload.session = JSON.parse(bytes)
        if (!validTranscript(payload.session, payload.opencode_version) || payload.session.info?.parentID || payload.session.info?.fork) throw new Error('Invalid conversation')
      } catch {
        payload.code_only = true
        delete payload.session
        process.stderr.write('Conversation unavailable. Keep saved code and start a fresh chat.\n')
      }
    }
  } finally { rmSync(download, { force: true }) }
  const checkpoint = validateCheckpoint(payload, source)
  if (source.source_commit && source.source_commit !== checkpoint.commit) throw new Error('The selected checkpoint has been replaced. Select the current saved version.')
  const importedSnapshot = usesImportedSnapshot(source, checkpoint)
  if (!importedSnapshot) {
    command('git', ['fetch', '--no-tags', `https://github.com/${source.source_repository}.git`, checkpoint.commit], { cwd: env.GITHUB_WORKSPACE })
    // Restore same-repository checkpoints before installing runtime-only files.
    command('git', ['checkout', '--detach', checkpoint.commit], { cwd: env.GITHUB_WORKSPACE })
  }
  writeFileSync(checkpointPath(), JSON.stringify(checkpoint), { mode: 0o600 })
  if (!importedSnapshot) setEnv('TARGET_SHA', checkpoint.commit)
  setEnv('PROJECT_PATH', checkpoint.project_dir || '.')
  setEnv('COMMENT_BODY', source.prompt)
  setEnv('RESUME_CHECKPOINT_FILE', checkpointPath())
}
export function restore() {
  if (!env.RESUME_CHECKPOINT_FILE) return
  const checkpoint = JSON.parse(readFileSync(env.RESUME_CHECKPOINT_FILE, 'utf8'))
  const status = value => {
    mkdirSync(env.OPENCODE_WEB_DIR, { recursive: true })
    writeFileSync(join(env.OPENCODE_WEB_DIR, 'resume-status.json'), JSON.stringify({ status: value }))
  }
  const fresh = () => {
    delete env.RESUME_SESSION_ID
    setEnv('RESUME_SESSION_ID', '')
    status('fresh')
    process.stderr.write('Code restored. Started a fresh chat.\n')
    return { status: 'fresh' }
  }
  if (checkpoint.import_history !== true || checkpoint.code_only) return fresh()
  const binary = env.OPENCODE_BIN || join(env.HOME, '.opencode/bin/opencode')
  // Verify the running binary independently; an invalid runtime is not an import failure.
  const version = normalizedVersion(command(binary, ['--version']))
  const file = join(env.RUNNER_TEMP, 'omgithub-session-import.json')
  try {
    if (!validTranscript(checkpoint.session, checkpoint.opencode_version) || checkpoint.session?.info?.parentID || checkpoint.session?.info?.fork) return fresh()
    const session = portableSession(checkpoint.session)
    session.info.location = { ...session.info.location, directory: resolve(env.PROJECT_DIR) }
    delete session.info.parentID
    writeFileSync(file, JSON.stringify(session), { mode: 0o600 })
    command(binary, ['session', 'import', file, '--standalone', '--directory', resolve(env.PROJECT_DIR)], { cwd: env.PROJECT_DIR })
    const restored = exportSession(binary, session.info.id, env.PROJECT_DIR, env.RUNNER_TEMP, version, true)
    if (restored.info?.id !== session.info.id || !isDeepStrictEqual(restored.messages, session.messages)) return fresh()
    setEnv('RESUME_SESSION_ID', session.info.id)
    status('restored')
    return { status: 'restored' }
  } catch { return fresh() }
  finally { rmSync(file, { force: true }) }
}
export function saveCheckpoint({ interrupted = false } = {}) {
  const root = resolve(env.GITHUB_WORKSPACE), project = resolve(env.PROJECT_DIR)
  const projectDir = relative(root, project)
  if (projectDir.startsWith('..') || projectDir.startsWith('/')) throw new Error('Project must be inside the repository.')
  const directory = env.OPENCODE_WEB_DIR
  const sessionFile = join(directory, 'checkpoint-session-id')
  if (!existsSync(sessionFile)) return null
  const sessionId = readFileSync(sessionFile, 'utf8').trim()
  if (!/^ses_[A-Za-z0-9]+$/.test(sessionId)) throw new Error('Invalid session ID.')
  const binary = env.OPENCODE_BIN || join(env.HOME, '.opencode/bin/opencode')
  const version = normalizedVersion(command(binary, ['--version']))
  const secrets = Object.entries(env).filter(([k]) => /TOKEN|SECRET|PASSWORD|API_KEY|AUTH_CONTENT|PRIVATE_KEY/.test(k)).map(([,v]) => v)
  // Authentication JSON can contain individual secrets echoed separately in tool output.
  const leaves = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(leaves) : []
  try { secrets.push(...leaves(JSON.parse(env.OPENCODE_AUTH_CONTENT || '{}'))) } catch {}
  if (env.OMGITHUB_SECRET_VALUES_FILE) secrets.push(...JSON.parse(readFileSync(env.OMGITHUB_SECRET_VALUES_FILE, 'utf8')))
  if (env.OMGITHUB_ACCOUNT_AUTH_FILE && existsSync(env.OMGITHUB_ACCOUNT_AUTH_FILE)) secrets.push(...leaves(JSON.parse(readFileSync(env.OMGITHUB_ACCOUNT_AUTH_FILE, 'utf8'))))
  const session = portableSession(redactSession(exportSession(binary, sessionId, project, env.RUNNER_TEMP, version), secrets))
  writeFileSync(join(directory, 'log-session-export.json'), JSON.stringify(session), { mode: 0o600 })
  const issue = Number(env.TRIGGER_ISSUE_NUMBER), run = Number(env.GITHUB_RUN_ID)
  const branch = `opencode-checkpoints/${issue}`
  const source = { source_repository: env.GITHUB_REPOSITORY, source_issue: issue }
  const gitEnv = { ...env, GIT_INDEX_FILE: join(directory, `checkpoint-index-${process.pid}`) }
  const git = (...args) => {
    const options = typeof args.at(-1) === 'object' ? args.pop() : {}
    return command('git', args, { cwd: root, env: gitEnv, ...options })
  }
  try {
    const remote = git('ls-remote', 'origin', `refs/heads/${branch}`).split(/\s/)[0] || ''
    const baseline = remote || git('ls-remote', 'origin', 'HEAD').split(/\s/)[0]
    if (baseline) git('fetch', '--no-tags', 'origin', baseline)
    git('read-tree', 'HEAD')
    const files = git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)
    const skipped = []
    let sourceBytes = 0
    const eligible = files.filter(path => {
      if (excludedPath(path)) return false
      try { const size = lstatSync(join(root, path)).size; sourceBytes += size <= 100000000 ? size : 0; if (size > 100000000) { skipped.push({ path, bytes: size }); return false } }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      return true
    })
    if (sourceBytes > 1500000000) throw new Error('Source snapshot exceeds the bounded Git push budget.')
    if (eligible.length) git('--literal-pathspecs', 'add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul', { input: eligible.join('\0') + '\0' })
    const exclude = files.filter(path => !eligible.includes(path))
    if (exclude.length) git('update-index', '--force-remove', '-z', '--stdin', { input: exclude.join('\0') + '\0' })
    if (baseline) retainWorkflowTree(git, baseline)
    const tree = git('write-tree')
    const fingerprint = digest(`${tree}\n${version}\n${JSON.stringify(session)}\n${JSON.stringify(skipped)}`)
    const stateFile = join(directory, 'checkpoint-state.json')
    let previous
    try { previous = JSON.parse(readFileSync(stateFile, 'utf8')) } catch {}
    if (previous?.fingerprint === fingerprint) return previous
    const generation = `${run}-${Date.now()}`
    const tag = `opencode-checkpoint-${issue}`
    const bytes = Buffer.from(JSON.stringify(session))
    const oversized = bytes.length > 100000000
    if (oversized) skipped.push({ path: '.omgithub/conversation.json', bytes: bytes.length })
    const metadata = { version: 2, repository: env.GITHUB_REPOSITORY, issue_number: issue, run_id: run, attempt: Number(env.GITHUB_RUN_ATTEMPT || 1), branch,
      project_dir: projectDir, opencode_version: version, public_history: true, generation, interrupted, source_tree: tree,
      conversation_status: oversized ? 'oversized' : 'saved', session_sha256: oversized ? null : digest(bytes), session_id: sessionId,
      skipped_files: skipped, created_at: new Date().toISOString() }
    const blob = (path, bytes) => git('update-index', '--add', '--cacheinfo', `100644,${git('hash-object', '-w', '--stdin', { input: bytes })},${path}`)
    blob('.omgithub/checkpoint.json', JSON.stringify(metadata))
    if (!oversized) blob('.omgithub/conversation.json', bytes)
    const parent = remote || git('rev-parse', 'HEAD')
    if (remote) {
      let prior
      try { prior = JSON.parse(git('show', `${remote}:.omgithub/checkpoint.json`)) } catch {}
      if (prior && (prior.run_id > run || prior.run_id === run && prior.attempt > metadata.attempt)) throw new Error('Checkpoint was superseded.')
    }
    const commit = git('commit-tree', git('write-tree'), '-p', parent, '-m', `Save source and v2 conversation for issue #${issue}\n\nRun: ${run}\nGeneration: ${generation}`)
    validateCheckpoint({ ...metadata, commit, code_only: oversized, ...(oversized ? {} : { session }) }, source)
    git('push', 'origin', `${commit}:refs/heads/${branch}`)
    const state = { fingerprint, tag, commit, generation, sessionId }
    writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 })
    return state
  } finally { rmSync(gitEnv.GIT_INDEX_FILE, { force: true }) }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2]
    if (mode === 'prepare') prepare()
    else if (mode === 'restore') restore()
    else if (mode === 'save') saveCheckpoint()
    else if (mode === 'shutdown') saveCheckpoint({ interrupted: true })
    else throw new Error('Use prepare, restore, save, or shutdown.')
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
