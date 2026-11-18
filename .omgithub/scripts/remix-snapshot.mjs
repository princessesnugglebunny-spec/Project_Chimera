import { execFileSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export function parseSnapshot(request) {
  const matches = [...String(request).matchAll(/<!-- omgithub-snapshot:v1 (\{[^\n]*\}) -->/g)]
  if (!matches.length) {
    if (/<!--\s*omgithub-snapshot:/i.test(request)) throw new Error('Invalid remix snapshot metadata.')
    return null
  }
  if (matches.length !== 1) throw new Error('Ambiguous remix snapshot metadata.')
  const value = JSON.parse(matches[0][1])
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.source_repository || '') || !/^[a-f0-9]{40}$/.test(value.source_commit || '')) throw new Error('Select a repository and full snapshot commit.')
  return { source_repository: value.source_repository, source_commit: value.source_commit, prompt: String(request).replace(matches[0][0], '').trim() }
}

const reserved = ['.omgithub', '.git', '.omgithub-runtime', '.opencode-web', '.opencode-ssh', '.agentsweb', '.omgithub-remix.json', '.github/workflows']
export const preserve = path => reserved.some(name => path === name || path.startsWith(`${name}/`))
export function command(file, args, options = {}) {
  const start = Date.now()
  try { return String(execFileSync(file, args, { encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options }) || '').trim() }
  catch (error) {
    const output = [error.stdout, error.stderr].map(value => String(value || '').trim()).filter(Boolean).map(value => value.slice(-4000)).join('\n')
    throw new Error(`${file} ${args[0]} failed (${error.status ?? 'timeout'}). ${output}`)
  }
  finally { process.stderr.write(`[timing] ${file} ${args[0]}: ${Date.now() - start} ms\n`) }
}

export function importSnapshot({ root, directory, source, run = command }) {
  root = resolve(root)
  const git = (...args) => run('git', args, { cwd: root })
  const marker = join(root, '.omgithub-remix.json')
  if (existsSync(marker)) {
    const previous = JSON.parse(readFileSync(marker, 'utf8'))
    if (previous.source_repository === source.source_repository && previous.source_commit === source.source_commit) return git('rev-parse', 'HEAD')
  }
  if (existsSync(join(directory, '.github')) && lstatSync(join(directory, '.github')).isSymbolicLink()) throw new Error('The snapshot .github path must be a directory.')
  // Remove only tracked project files. Keep the runner checkout and installed listener.
  for (const path of git('ls-files', '-z').split('\0').filter(Boolean)) {
    if (!preserve(path)) rmSync(join(root, path), { force: true })
  }
  for (const name of readdirSync(directory)) {
    if (preserve(name)) continue
    cpSync(join(directory, name), join(root, name), { recursive: true, verbatimSymlinks: true,
      filter: path => !preserve(path.slice(directory.length + 1)) })
  }
  const metadata = { source_repository: source.source_repository, source_commit: source.source_commit,
    source_url: `https://github.com/${source.source_repository}/tree/${source.source_commit}` }
  writeFileSync(marker, `${JSON.stringify(metadata, null, 2)}\n`)
  git('add', '--all', '--force', '--', '.', ...reserved.filter(name => name !== '.git' && name !== '.omgithub-remix.json').map(name => `:(exclude)${name}`))
  git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit', '-m', `Import remix snapshot from ${source.source_repository}\n\nSource: ${metadata.source_url}`)
  return git('rev-parse', 'HEAD')
}

export function fetchSnapshotLfs({ root, source, run = command }) {
  const options = { cwd: root }
  const files = run('git', ['lfs', 'ls-files', '--name-only'], options)
  if (!files) return false
  const remote = `omgithub-snapshot-${randomUUID()}`
  console.log(`Fetch ${files.split('\n').length} source Git LFS objects`)
  run('git', ['remote', 'add', remote, `https://github.com/${source.source_repository}.git`], options)
  try {
    run('git', ['fetch', '--no-tags', '--depth=1', remote, source.source_commit], options)
    run('git', ['lfs', 'fetch', remote, 'FETCH_HEAD'], options)
  } finally {
    run('git', ['remote', 'remove', remote], options)
  }
  return true
}

export function prepareSnapshot(env = process.env, run = command) {
  const source = parseSnapshot(env.COMMENT_BODY || '')
  if (!source) return
  if (!env.GITHUB_WORKSPACE || !env.GITHUB_ENV || !env.TARGET_REF) throw new Error('Missing runner workspace or target branch.')
  run('git', ['check-ref-format', `refs/heads/${env.TARGET_REF}`])
  const root = resolve(env.GITHUB_WORKSPACE)
  const temporary = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'omgithub-snapshot-'))
  try {
    const archive = join(temporary, 'snapshot.tar.gz'), directory = join(temporary, 'source')
    console.log(`Download selected version: ${source.source_repository}@${source.source_commit}`)
    // Public codeload avoids transferring history or forwarding the destination token.
    run('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--connect-timeout', '30', '--max-time', '480',
      '--output', archive, `https://codeload.github.com/${source.source_repository}/tar.gz/${source.source_commit}`])
    console.log(`Downloaded snapshot archive: ${(statSync(archive).size / 1024 / 1024).toFixed(1)} MiB`)
    run('python3', ['-c', `import os,sys,tarfile,shutil,posixpath
archive,dest=sys.argv[1:]
os.makedirs(dest)
links=[]
with tarfile.open(archive) as tar:
    roots=set()
    for item in tar:
        parts=item.name.split('/')
        roots.add(parts[0])
        if len(roots)!=1 or parts[0] in ('','..','.'): raise ValueError('Invalid snapshot archive root')
        name='/'.join(parts[1:]).rstrip('/')
        if not name: continue
        if name.startswith('/') or any(p in ('..','.git','') for p in name.split('/')): raise ValueError('Invalid snapshot path')
        path=os.path.join(dest,name)
        if item.isdir(): os.makedirs(path,exist_ok=True)
        elif item.isfile():
            os.makedirs(os.path.dirname(path),exist_ok=True)
            with tar.extractfile(item) as src, open(path,'xb') as out: shutil.copyfileobj(src,out)
            os.chmod(path,item.mode & 0o777)
        elif item.issym():
            target=posixpath.normpath(posixpath.join(posixpath.dirname(name),item.linkname))
            if item.linkname.startswith('/') or target=='..' or target.startswith('../'): raise ValueError('Invalid snapshot link')
            links.append((path,item.linkname))
        else: raise ValueError('Unsupported snapshot entry')
for path,target in links:
    os.makedirs(os.path.dirname(path),exist_ok=True)
    os.symlink(target,path)
for path,_ in links:
    if os.path.commonpath([os.path.realpath(path),os.path.realpath(dest)])!=os.path.realpath(dest): raise ValueError('Invalid snapshot link target')
`, archive, directory])
    console.log('Import selected files and preserve the execution workflow')
    const sha = importSnapshot({ root, directory, source, run })
    fetchSnapshotLfs({ root, source, run })
    // A normal push preserves concurrent updates rather than replacing them.
    run('git', ['push', '--porcelain', '--no-progress', 'origin', `${sha}:refs/heads/${env.TARGET_REF}`], { cwd: root })
    const values = { TARGET_SHA: sha, COMMENT_BODY: source.prompt, SNAPSHOT_SOURCE_REPOSITORY: source.source_repository, SNAPSHOT_SOURCE_COMMIT: source.source_commit }
    for (const [name, value] of Object.entries(values)) {
      const delimiter = `snapshot_${randomUUID()}`
      appendFileSync(env.GITHUB_ENV, `${name}<<${delimiter}\n${value}\n${delimiter}\n`)
    }
    console.log('Snapshot ready; continue project setup')
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { prepareSnapshot() } catch (error) { console.error(`Remix preparation failed: ${error.message}`); process.exitCode = 1 }
}
