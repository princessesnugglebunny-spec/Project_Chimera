import { createServer } from 'vite'
import serveIndex from 'serve-index'
import { stat, readFile } from 'node:fs/promises'
import { resolve, relative, isAbsolute, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const textExtensions = new Set(['.md', '.markdown', '.sh', '.bash', '.zsh', '.fish', '.log'])

export function directoryBrowser(root) {
  const listing = serveIndex(root, { icons: true, view: 'details' })
  return {
    name: 'omgithub-directory-browser',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()
        try {
          const url = new URL(req.url, 'http://localhost')
          const file = resolve(root, '.' + decodeURIComponent(url.pathname))
          const within = relative(root, file)
          if (within.startsWith('..') || isAbsolute(within)) return next()
          const info = await stat(file)
          res.setHeader('Cache-Control', 'no-cache')
          if (info.isDirectory()) {
            if (!url.pathname.endsWith('/')) {
              res.writeHead(302, { Location: url.pathname + '/' + url.search }); res.end(); return
            }
            return listing(req, res, next)
          }
          // Keep document/source browsing readable; leave browser modules to Vite.
          if (textExtensions.has(extname(file)) && !url.searchParams.has('import') && !url.searchParams.has('raw')) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end(req.method === 'HEAD' ? undefined : await readFile(file)); return
          }
          next()
        } catch (error) {
          if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return next()
          next(error)
        }
      })
    }
  }
}

export async function startLiveFiles({ root, port = 0, cacheDir, allowedHosts = [] } = {}) {
  root = resolve(root)
  const server = await createServer({
    // Start before the agent creates package.json/config/dependencies. Keep this
    // managed source browser independent of project build and startup scripts.
    configFile: false,
    root,
    base: '/',
    appType: 'mpa',
    cacheDir,
    plugins: [directoryBrowser(root)],
    server: {
      host: '127.0.0.1', port, strictPort: true,
      allowedHosts,
      headers: { 'Cache-Control': 'no-cache' }
    }
  })
  await server.listen()
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const started = performance.now()
  const server = await startLiveFiles({
    root: process.env.PROJECT_DIR,
    port: Number(process.env.PROJECT_FILE_PORT),
    cacheDir: join(process.env.OPENCODE_WEB_DIR, 'live-vite-cache'),
    allowedHosts: ['.omgithub.com', '.lolgames.net']
  })
  console.error(`[timing] live source server startup: ${Math.round(performance.now() - started)} ms`)
  server.printUrls()
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0) })
}
