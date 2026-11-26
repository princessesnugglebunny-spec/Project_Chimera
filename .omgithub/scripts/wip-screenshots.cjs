const { createHash } = require('node:crypto')
const { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, appendFileSync } = require('node:fs')
const { join } = require('node:path')

function webDirectory(env) { return env.OMGITHUB_CAPTURE_WEB_DIR || env.OPENCODE_WEB_DIR }
// Controller-owned loopback ports never count as project pages: the OpenCode
// server default, and cloudflared's default metrics range. Runtime-allocated
// controller ports come from the workflow env and $OPENCODE_WEB_DIR/controller-ports.
const CONTROLLER_PORTS = [4096, 20241, 20242, 20243, 20244, 20245]
const CONTROLLER_PORT_ENV = ['OPENCODE_WEB_PORT', 'OPENCODE_CONTROL_PORT', 'PROJECT_FILE_PORT']
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
function controllerPorts(env = process.env) {
  const ports = [...CONTROLLER_PORTS, ...CONTROLLER_PORT_ENV.map(name => env[name])]
  const directory = webDirectory(env)
  if (directory) try { ports.push(...readFileSync(join(directory, 'controller-ports'), 'utf8').split(/\s+/)) } catch {}
  return new Set(ports.map(Number).filter(port => Number.isSafeInteger(port) && port > 0))
}
function projectOrigins(env = process.env) {
  const directory = webDirectory(env)
  const port = env.APP_PORT || 3000
  const urls = [`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`]
  if (env.APP_URL) urls.push(env.APP_URL)
  if (directory) {
    try { urls.push(readFileSync(join(directory, 'app-url'), 'utf8').trim()) } catch {}
    try { urls.push(...JSON.parse(readFileSync(join(directory, 'project-preview-origins.json'), 'utf8'))) } catch {}
  }
  return new Set(urls.flatMap(url => { try { return [new URL(url).origin] } catch { return [] } }))
}
// Returns '' for project pages, otherwise the skip reason.
function skipReason(url, env = process.env) {
  let parsed
  try { parsed = new URL(url) } catch { return 'invalid page URL' }
  if (!/^https?:$/.test(parsed.protocol)) return 'non-HTTP page'
  if (projectOrigins(env).has(parsed.origin)) return ''
  if (LOOPBACK_HOSTS.has(parsed.hostname)) {
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
    return controllerPorts(env).has(port) ? 'controller port' : ''
  }
  return 'origin not a project preview'
}
function isProjectPage(url, env = process.env) { return !skipReason(url, env) }
function safeOrigin(url) { try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.origin : parsed.protocol } catch { return 'invalid' } }
function logSkip(reason, url, env) {
  const line = `WIP screenshot skipped: ${reason} (${safeOrigin(url)})`
  console.error(line)
  const web = webDirectory(env)
  if (web) try { appendFileSync(join(web, 'wip-capture.log'), `${new Date().toISOString()} ${line}\n`) } catch {}
}
function imageType(bytes) {
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  return ''
}
function queueScreenshot(bytes, metadata, env = process.env) {
  const web = webDirectory(env)
  if (!web) return null
  const reason = skipReason(metadata.page_url, env)
  if (reason) { logSkip(reason, metadata.page_url, env); return null }
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 10 * 1024 * 1024) { logSkip('empty or over 10 MB', metadata.page_url, env); return null }
  const type = imageType(bytes)
  if (!type) { logSkip('not PNG, JPEG, or WebP', metadata.page_url, env); return null }
  const hash = createHash('sha256').update(bytes).digest('hex'), dir = join(web, 'wip-queue')
  mkdirSync(dir, { recursive: true })
  if (existsSync(join(dir, `${hash}.json`)) || existsSync(join(dir, `${hash}.done`))) return hash
  const page = new URL(metadata.page_url); page.search = ''; page.hash = ''; page.username = ''; page.password = ''
  const value = { ...metadata, page_url: page.href, captured_at: metadata.captured_at || Date.now(), type, hash }
  try { writeFileSync(join(dir, `${hash}.image`), bytes, { flag: 'wx', mode: 0o600 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
  const temporary = join(dir, `${hash}.${process.pid}.tmp`)
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
  renameSync(temporary, join(dir, `${hash}.json`))
  return hash
}

// Keep agent screenshots small: CSS-pixel scale (no 2x/3x device pixels) and JPEG
// quality 70 when the caller asks for JPEG (type or .jpg/.jpeg path). PNG stays PNG so
// file names never lie about their bytes. OMGITHUB_SCREENSHOT_FULL=1 keeps full detail.
function shrinkOptions(options, env = process.env) {
  if (env.OMGITHUB_SCREENSHOT_FULL === '1') return options
  const value = { ...(options && typeof options === 'object' ? options : {}) }
  value.scale ??= 'css'
  const jpeg = value.type === 'jpeg' || (!value.type && /\.jpe?g$/i.test(value.path || ''))
  if (jpeg) value.quality ??= 70
  return value
}

// Wrap public browser APIs so CLI screenshot, run-code, and locator captures
// use the same provenance, including captures that never become OC attachments.
function instrument(playwright, env = process.env) {
  const patched = Symbol.for('omgithub.wipScreenshot')
  function patchScreenshot(prototype, pageFor) {
    if (!prototype?.screenshot || prototype.screenshot[patched]) return
    const original = prototype.screenshot
    const wrapped = async function (...args) {
      const page = pageFor(this), page_url = page.url(), captured_at = Date.now()
      const bytes = await original.apply(this, [shrinkOptions(args[0], env), ...args.slice(1)])
      if (page.url() === page_url) {
        try { queueScreenshot(bytes, { page_url, captured_at, browser_session: env.OMGITHUB_BROWSER_SESSION || '', session_id: env.OPENCODE_SESSION_ID || '' }, env) }
        catch (error) { console.error('WIP capture deferred:', error.message) }
      }
      return bytes
    }
    wrapped[patched] = true
    prototype.screenshot = wrapped
  }
  function pageReady(page) {
    patchScreenshot(Object.getPrototypeOf(page), page => page)
    patchScreenshot(Object.getPrototypeOf(page.locator('html')), locator => locator.page())
  }
  function contextReady(context) {
    for (const page of context.pages()) pageReady(page)
    context.on('page', pageReady)
    return context
  }
  function browserReady(browser) {
    for (const context of browser.contexts()) contextReady(context)
    const original = browser.newContext.bind(browser)
    browser.newContext = async (...args) => contextReady(await original(...args))
    return browser
  }
  for (const type of [playwright.chromium, playwright.firefox, playwright.webkit].filter(Boolean)) {
    for (const name of ['launch', 'connect', 'connectOverCDP', 'launchPersistentContext']) {
      if (!type[name] || type[name][patched]) continue
      const original = type[name].bind(type)
      const wrapped = async (...args) => name === 'launchPersistentContext' ? contextReady(await original(...args)) : browserReady(await original(...args))
      wrapped[patched] = true; type[name] = wrapped
    }
  }
}
module.exports = { shrinkOptions, projectOrigins, controllerPorts, skipReason, isProjectPage, imageType, queueScreenshot, instrument, webDirectory }
