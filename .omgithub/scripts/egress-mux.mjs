// Front CONNECT mux for phone-first egress: device allowlist hosts go to the
// device relay; everything else prefers the general WARP proxy
// when one is configured. models.opencode.ai never uses the phone — with no
// general proxy it is connected directly (runner network).
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { writeFileSync } from 'node:fs'

/** Hosts that must use the device (phone) relay. models.opencode.ai is intentionally absent. */
export const DEVICE_HOSTS = Object.freeze(['opencode.ai', 'openrouter.ai'])

export function isDeviceHost(host) {
  const h = String(host || '').toLowerCase()
  return DEVICE_HOSTS.includes(h)
}

function parseProxyUrl(url) {
  if (!url) return null
  const u = new URL(String(url))
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('egress-mux: only http proxies')
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') throw new Error('egress-mux: refusing non-local proxy')
  return { host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) }
}

/**
 * Tie the two ends together so a reset on either side can never escape as an unhandled
 * 'error' event. Without this the whole process exits on EPIPE/ECONNRESET and OpenCode,
 * still pointed at this port, starts failing every model call with ECONNREFUSED.
 */
function tieSockets(client, upstream) {
  const kill = () => {
    try { client.destroy() } catch {}
    try { upstream?.destroy() } catch {}
  }
  client.on('error', kill)
  client.on('close', kill)
  if (upstream) {
    upstream.on('error', kill)
    upstream.on('close', kill)
  }
  return kill
}

function connectViaProxy(proxy, target, client, head) {
  let upstream = null
  const kill = () => {
    try { client.destroy() } catch {}
    try { upstream?.destroy() } catch {}
  }
  client.on('error', kill)
  client.on('close', kill)
  const req = httpRequest({
    host: proxy.host,
    port: proxy.port,
    method: 'CONNECT',
    path: target,
    headers: { host: target },
  })
  req.on('connect', (res, socket) => {
    upstream = socket
    socket.on('error', kill)
    socket.on('close', kill)
    if (res.statusCode !== 200) {
      try { client.end(`HTTP/1.1 ${res.statusCode || 502} Bad Gateway\r\n\r\n`) } catch {}
      try { socket.destroy() } catch {}
      return
    }
    try {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head?.length) socket.write(head)
    } catch {
      kill()
      return
    }
    socket.pipe(client); client.pipe(socket)
  })
  req.on('error', () => { try { client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n') } catch {} })
  req.end()
}

/**
 * @param {{ deviceProxy: string, generalProxy?: string|null, connectDirect?: typeof connect }} opts
 */
export function createEgressMux({ deviceProxy, generalProxy = null, connectDirect = connect } = {}) {
  const device = parseProxyUrl(deviceProxy)
  if (!device) throw new Error('egress-mux: deviceProxy required')
  const general = generalProxy ? parseProxyUrl(generalProxy) : null
  const totals = { device: 0, general: 0, direct: 0, forbidden: 0 }

  const server = createServer((_req, res) => { res.writeHead(405, { connection: 'close' }); res.end() })
  server.on('error', error => { console.error(`[egress-mux] server error: ${error?.code || error?.message || error}`) })
  server.on('connect', (req, client, head) => {
    client.on('error', () => {})
    const target = String(req.url || '')
    if (!/^[A-Za-z0-9.-]+:\d{1,5}$/.test(target)) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return }
    const hostname = target.replace(/:\d+$/, '').toLowerCase()

    if (isDeviceHost(hostname)) {
      totals.device++
      connectViaProxy(device, target, client, head)
      return
    }
    if (general) {
      totals.general++
      connectViaProxy(general, target, client, head)
      return
    }
    if (hostname === 'models.opencode.ai') {
      totals.direct++
      const port = Number(target.split(':')[1])
      const upstream = connectDirect({ host: hostname, port })
      tieSockets(client, upstream)
      upstream.on('connect', () => {
        try {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          if (head?.length) upstream.write(head)
        } catch {
          upstream.destroy()
          return
        }
        upstream.pipe(client); client.pipe(upstream)
      })
      upstream.on('error', () => { try { client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n') } catch {} })
      return
    }
    totals.forbidden++
    client.end('HTTP/1.1 403 Forbidden\r\n\r\n')
  })
  return { server, totals, deviceHosts: DEVICE_HOSTS }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const positional = []
  let portOverride = 0
  for (const arg of process.argv.slice(2)) {
    if (arg === '--port') portOverride = -1
    else if (portOverride === -1) { portOverride = Number(arg); }
    else positional.push(arg)
  }
  if (portOverride === -1) { console.error('egress-mux: --port needs a number'); process.exit(2) }
  const [deviceProxy, generalProxy = '', portFile] = positional
  if (!deviceProxy || !portFile) {
    console.error('Usage: node egress-mux.mjs <device-proxy-url> [general-proxy-url|\'\'] <port-file> [--port N]')
    process.exit(2)
  }
  const { server } = createEgressMux({ deviceProxy, generalProxy: generalProxy || null })
  server.listen(Number(portOverride) || 0, '127.0.0.1', () => {
    if (!portOverride) writeFileSync(portFile, String(server.address().port))
  })
}
