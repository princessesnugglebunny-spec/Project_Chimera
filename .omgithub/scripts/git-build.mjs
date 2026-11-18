import { execFileSync } from 'node:child_process'
import { readdirSync, lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export function commitBuild({ root, directory, temporary, repository, issue, run, attempt, generation, sourceCommit }) {
  const started = Date.now()
  const index = join(temporary, `build-index-${process.pid}`)
  const command = (args, options = {}) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim()
  const env = { ...process.env, GIT_INDEX_FILE: index }
  const git = (args, input) => command(args, { env, ...(input === undefined ? {} : { input }) })
  const branch = `opencode-deployments/${issue}`
  const skipped = [], entries = []
  function walk(base, prefix = '') {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (/^(?:\.git|\.omgithub|\.env(?:\..*)?|node_modules|\.opencode.*|\.agents|\.playwright-cli|\.omgithub-runtime)$/.test(entry.name) || /\.(?:log|pid|pem|key)$/.test(entry.name)) continue
      const path = join(base, entry.name), name = prefix + entry.name
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) walk(path, name + '/')
      else if (entry.isFile()) {
        const size = lstatSync(path).size
        if (size > 100000000) skipped.push({ path: name, bytes: size })
        else entries.push({ path, name })
      }
    }
  }
  try {
    if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('A source checkpoint is required')
    walk(resolve(directory))
    if (!entries.some(x => x.name === 'index.html')) throw new Error('Build has no index.html')
    if (skipped.length) {
      writeFileSync(join(temporary, 'skipped-build-files.json'), JSON.stringify(skipped))
      throw new Error(`Build exceeds the per-file Git limit: ${skipped.map(x => x.path).join(', ')}`)
    }
    if (entries.reduce((sum, entry) => sum + lstatSync(entry.path).size, 0) > 1500000000) throw new Error('Build exceeds the bounded Git push budget')
    const remote = command(['ls-remote', 'origin', `refs/heads/${branch}`]).split(/\s/)[0] || ''
    if (remote) command(['fetch', '--no-tags', 'origin', remote])
    git(['read-tree', '--empty'])
    const put = (name, hash) => git(['update-index', '--add', '--cacheinfo', `100644,${hash},${name}`])
    for (const entry of entries) put(entry.name, git(['hash-object', '-w', entry.path]))
    const html = readFileSync(join(directory, 'index.html'), 'utf8')
    const manifest = { version: 1, repository, issue_number: Number(issue), run_id: String(run), attempt: Number(attempt), generation: String(generation), source_commit: sourceCommit,
      title: (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || 'Game').slice(0, 160),
      description: '', skipped_files: skipped }
    put('.omgithub/deployment.json', git(['hash-object', '-w', '--stdin'], JSON.stringify(manifest)))
    const commit = git(['commit-tree', git(['write-tree']), '-p', remote || sourceCommit, '-m', `Publish static build for issue #${issue}\n\nRun: ${run}\nAttempt: ${attempt}\nGeneration: ${generation}\nSource: ${sourceCommit}`])
    command(['push', 'origin', `${commit}:refs/heads/${branch}`])
    return { build_commit: commit, source_commit: sourceCommit, manifest }
  } finally { rmSync(index, { force: true }); console.error(`[timing] Git build publication: ${Date.now() - started} ms`) }
}
