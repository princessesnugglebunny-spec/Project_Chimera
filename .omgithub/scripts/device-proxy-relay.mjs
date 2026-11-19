#!/usr/bin/env node
// Local CONNECT relay whose upstream is the owner's phone via omsite device-relay WSS.
// OpenCode only ever sees http://127.0.0.1:PORT. Creds file is read once and deleted.
// Uses a minimal WebSocket client (HTTP upgrade + frames) so Authorization works on
// Node's runners without the `ws` package (global WebSocket cannot set headers).
//
// Usage: node device-proxy-relay.mjs <creds-file> <port-file> <bytes-file>
// creds-file: JSON { token, ws_url, max_bytes?, max_streams? }
import { createServer } from 'node:http'
import { connect as tlsConnect } from 'node:tls'
import { connect as netConnect } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve as resolvePath } from 'node:path'

export const PROTOCOL = 1
export const DEFAULT_MAX_BYTES = 150 * 1024 * 1024
export const MAX_FRAME_PAYLOAD = 64 * 1024
/** Per PROTOCOL.md / Android DeviceRelayProto: start credit and half-window grant batch. */
export const INITIAL_CREDIT = 32
export const WINDOW_BATCH = INITIAL_CREDIT / 2
export const ALLOWED_HOSTS = Object.freeze(['opencode.ai', 'openrouter.ai'])

export function isAllowedOpen(host, port) {
  const h = String(host || '').toLowerCase()
  return Number(port) === 443 && ALLOWED_HOSTS.includes(h) && !/[^a-z0-9.-]/.test(h)
}

export function parseBinaryFrame(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null
  if (buf.length - 4 > MAX_FRAME_PAYLOAD) return null
  return { id: buf.readUInt32BE(0), payload: buf.subarray(4) }
}

export function encodeBinaryFrame(id, payload) {
  const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  if (p.length > MAX_FRAME_PAYLOAD) throw new Error('frame too large')
  const out = Buffer.allocUnsafe(4 + p.length)
  out.writeUInt32BE(id >>> 0, 0)
  p.copy(out, 4)
  return out
}

/** Minimal client WebSocket with custom headers (Node global WebSocket cannot set them). */
export function openSocket(url, { headers = {}, timeoutMs = 15000 } = {}) {
  const u = new URL(url)
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') throw new Error('ws/wss required')
  const tls = u.protocol === 'wss:'
  const port = Number(u.port) || (tls ? 443 : 80)
  const key = randomBytes(16).toString('base64')
  const ee = new EventEmitter()
  let socket, buffer = Buffer.alloc(0), open = false, closed = false

  const finishErr = (err) => { if (closed) return; closed = true; try { socket?.destroy() } catch {}; ee.emit('error', err); ee.emit('close') }

  const sendFrame = (opcode, payload) => {
    if (!open || !socket || socket.destroyed) return
    const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
    const mask = randomBytes(4)
    const len = p.length
    let header
    if (len < 126) { header = Buffer.alloc(2); header[1] = 0x80 | len }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2) }
    else { header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2) }
    header[0] = 0x80 | (opcode & 0x0f)
    const masked = Buffer.allocUnsafe(len)
    for (let i = 0; i < len; i++) masked[i] = p[i] ^ mask[i & 3]
    socket.write(Buffer.concat([header, mask, masked]))
  }

  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    if (!open) {
      const end = buffer.indexOf('\r\n\r\n')
      if (end < 0) { if (buffer.length > 8192) finishErr(new Error('upgrade too large')); return }
      const head = buffer.subarray(0, end).toString('latin1')
      buffer = buffer.subarray(end + 4)
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(head)
      const accept = /Sec-WebSocket-Accept:\s*(\S+)/i.exec(head)
      const expected = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
      if (!status || status[1] !== '101' || accept?.[1] !== expected) {
        finishErr(new Error(`upgrade failed (${status?.[1] || 'no status'})`)); return
      }
      open = true
      ee.emit('open')
      if (!buffer.length) return
    }
    while (buffer.length >= 2) {
      const b0 = buffer[0], b1 = buffer[1]
      const opcode = b0 & 0x0f
      const masked = (b1 & 0x80) !== 0
      let len = b1 & 0x7f, off = 2
      if (len === 126) { if (buffer.length < 4) return; len = buffer.readUInt16BE(2); off = 4 }
      else if (len === 127) { if (buffer.length < 10) return; len = Number(buffer.readBigUInt64BE(2)); off = 10 }
      const maskLen = masked ? 4 : 0
      if (buffer.length < off + maskLen + len) return
      let payload = buffer.subarray(off + maskLen, off + maskLen + len)
      if (masked) {
        const mask = buffer.subarray(off, off + 4)
        const out = Buffer.allocUnsafe(len)
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3]
        payload = out
      }
      buffer = buffer.subarray(off + maskLen + len)
      if (opcode === 0x8) { closed = true; try { socket.end() } catch {}; ee.emit('close'); return }
      if (opcode === 0x9) { sendFrame(0xA, payload); continue } // ping → pong
      if (opcode === 0xA) continue
      if (opcode === 0x1) ee.emit('message', payload.toString('utf8'), false)
      else if (opcode === 0x2) ee.emit('message', payload, true)
    }
  }

  const path = `${u.pathname}${u.search}` || '/'
  const lines = [
    `GET ${path} HTTP/1.1`,
    `Host: ${u.host}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
    '',
    '',
  ]
  const raw = lines.join('\r\n')

  const onConnect = () => {
    socket.setNoDelay(true)
    socket.on('data', onData)
    socket.on('error', finishErr)
    socket.on('close', () => { if (!closed) { closed = true; ee.emit('close') } })
    socket.write(raw)
  }

  socket = tls
    ? tlsConnect({ host: u.hostname, port, servername: u.hostname, ALPNProtocols: ['http/1.1'] }, onConnect)
    : netConnect({ host: u.hostname, port }, onConnect)
  socket.setTimeout(timeoutMs, () => { if (!open) finishErr(new Error('connect timeout')) })

  return {
    get readyState() { return closed ? 3 : open ? 1 : 0 },
    send(data, opts) {
      if (opts?.binary || Buffer.isBuffer(data)) sendFrame(0x2, data)
      else sendFrame(0x1, typeof data === 'string' ? data : String(data))
    },
    close() { if (closed) return; try { sendFrame(0x8, Buffer.alloc(0)) } catch {}; closed = true; try { socket.end() } catch {}; ee.emit('close') },
    on: ee.on.bind(ee),
    once: ee.once.bind(ee),
    off: ee.off.bind(ee),
  }
}

export function createDeviceProxyRelay({
  token, wsUrl, maxBytes = DEFAULT_MAX_BYTES, maxStreams = 8, onFailure = () => {}, openSocketImpl = openSocket,
} = {}) {
  if (!token || !wsUrl) throw new Error('device-proxy-relay requires token and ws_url')

  const totals = { up: 0, down: 0, tunnels: 0, failed: 0, last_error: '', capped: 0, hosts: {} }
  const count = (name, n) => { if (name in totals.hosts || Object.keys(totals.hosts).length < 50) totals.hosts[name] = (totals.hosts[name] || 0) + n }
  const streams = new Map()
  let nextId = 1
  let ready = false
  let closed = false
  let ws

  const failAll = (reason) => {
    totals.last_error = String(reason || 'offline').slice(0, 80)
    for (const [id, s] of [...streams]) {
      streams.delete(id)
      try { if (!s.open) s.client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); else s.client.destroy() } catch {}
    }
    onFailure()
  }

  const grantWindow = (s) => {
    if (!ws || ws.readyState !== 1 || !s) return
    const n = s.consumed | 0
    if (n <= 0) return
    s.consumed = 0
    try { ws.send(JSON.stringify({ v: PROTOCOL, type: 'window', id: s.id, credit: Math.max(0, Math.min(256, n)) })) } catch {}
  }

  /** Consume one inbound (device→runner) frame: grant credit in WINDOW_BATCH chunks (match Android). */
  const onDeviceFrame = (s) => {
    s.consumed = (s.consumed | 0) + 1
    if (s.consumed >= WINDOW_BATCH) grantWindow(s)
  }

  const flushQueue = (s) => {
    if (!s) return
    while (s.queue.length && s.credit > 0 && ws?.readyState === 1) {
      const payload = s.queue.shift()
      s.credit--
      totals.up += payload.length
      count(s.host, payload.length)
      try { ws.send(encodeBinaryFrame(s.id, payload), { binary: true }) } catch { break }
    }
    if (s.queue.length === 0 && s.credit > 0) {
      try { s.client.resume() } catch {}
    } else if (s.credit <= 0 || s.queue.length) {
      try { s.client.pause() } catch {}
    }
  }

  /** Send runner→device payload; pause local CONNECT client when credit hits 0. */
  const sendPayload = (s, payload) => {
    if (!s || !ws || ws.readyState !== 1) return
    const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
    if (s.credit <= 0 || s.queue.length) {
      s.queue.push(Buffer.from(p))
      try { s.client.pause() } catch {}
      return
    }
    s.credit--
    totals.up += p.length
    count(s.host, p.length)
    try { ws.send(encodeBinaryFrame(s.id, p), { binary: true }) } catch {}
    if (s.credit <= 0) try { s.client.pause() } catch {}
  }

  const closeStream = (id, reason) => {
    const s = streams.get(id)
    if (!s) return
    streams.delete(id)
    if (s.consumed) grantWindow(s)
    if (ws?.readyState === 1) {
      try { ws.send(JSON.stringify({ v: PROTOCOL, type: 'close', id, reason })) } catch {}
    }
    try { s.client.destroy() } catch {}
  }

  ws = openSocketImpl(wsUrl, { headers: { Authorization: `Bearer ${token}` } })
  ws.on('open', () => {
    ws.send(JSON.stringify({ v: PROTOCOL, type: 'hello', role: 'runner', token }))
  })
  ws.on('message', (data, isBinary) => {
    if (isBinary || Buffer.isBuffer(data)) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
      const frame = parseBinaryFrame(buf)
      if (!frame) return
      const s = streams.get(frame.id)
      if (!s?.open || s.client.destroyed) return
      totals.down += frame.payload.length
      count(s.host, frame.payload.length)
      try { s.client.write(frame.payload) } catch {}
      onDeviceFrame(s)
      return
    }
    let msg
    try { msg = JSON.parse(String(data)) } catch { return }
    if (msg.type === 'ready') { ready = true; return }
    if (msg.type === 'ping') { try { ws.send(JSON.stringify({ v: PROTOCOL, type: 'pong', t: msg.t })) } catch {}; return }
    if (msg.type === 'window') {
      const s = streams.get(Number(msg.id))
      if (!s) return
      // PROTOCOL: each window *adds* credit (Android addCredit); clamp total.
      const add = Math.max(0, Math.min(256, Number(msg.credit) | 0))
      s.credit = Math.max(0, Math.min(256, (s.credit | 0) + add))
      flushQueue(s)
      return
    }
    if (msg.type === 'opened') {
      const s = streams.get(Number(msg.id))
      if (!s || s.open) return
      s.open = true
      totals.tunnels++
      try { s.client.write('HTTP/1.1 200 Connection Established\r\n\r\n') } catch {}
      if (s.head?.length) {
        const head = s.head; s.head = null
        sendPayload(s, head)
      }
      s.client.on('data', chunk => {
        for (let off = 0; off < chunk.length; off += MAX_FRAME_PAYLOAD) {
          sendPayload(s, chunk.subarray(off, off + MAX_FRAME_PAYLOAD))
        }
      })
      s.client.on('close', () => closeStream(s.id, 'eof'))
      s.client.on('error', () => closeStream(s.id, 'error'))
      return
    }
    if (msg.type === 'open_error') {
      const s = streams.get(Number(msg.id))
      if (!s) return
      streams.delete(Number(msg.id))
      totals.failed++
      totals.last_error = String(msg.code || 'error').slice(0, 40)
      try { s.client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n') } catch {}
      if (msg.code === 'offline' || msg.code === 'cap') onFailure()
      return
    }
    if (msg.type === 'close') {
      const id = Number(msg.id)
      const s = streams.get(id)
      if (!s) return
      streams.delete(id)
      try { s.client.destroy() } catch {}
      return
    }
    // The phone went away (screen off, network switch, heartbeat loss). Fail every tunnel and
    // record offline now, so the watcher hands the build to the fallback within a couple of
    // seconds instead of waiting for the next CONNECT to time out.
    if (msg.type === 'device_offline') {
      failAll('offline')
      return
    }
    if (msg.type === 'error') {
      totals.last_error = String(msg.code || 'error')
      failAll(msg.code)
    }
  })
  ws.on('close', () => { if (!closed) failAll('offline') })
  ws.on('error', () => { /* close follows */ })

  const ping = setInterval(() => {
    if (ws?.readyState === 1) {
      try { ws.send(JSON.stringify({ v: PROTOCOL, type: 'ping', t: Date.now() })) } catch {}
    }
  }, 15_000)
  if (typeof ping.unref === 'function') ping.unref()

  const server = createServer((_req, res) => { res.writeHead(405, { connection: 'close' }); res.end() })
  server.on('connect', (req, client, head) => {
    const target = String(req.url || '')
    if (!/^[A-Za-z0-9.-]+:\d{1,5}$/.test(target)) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return }
    const [host, portStr] = target.split(':')
    const port = Number(portStr)
    if (!isAllowedOpen(host, port)) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return }
    if (maxBytes > 0 && totals.up + totals.down >= maxBytes) {
      totals.capped++; totals.last_error = 'byte cap reached'
      client.end('HTTP/1.1 503 Proxy Byte Cap Reached\r\n\r\n'); onFailure(); return
    }
    if (!ready || !ws || ws.readyState !== 1) {
      totals.failed++; totals.last_error = 'offline'
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); onFailure(); return
    }
    if (streams.size >= maxStreams) { client.end('HTTP/1.1 503 Too Many Streams\r\n\r\n'); return }
    const id = nextId++
    const hostname = host.toLowerCase()
    streams.set(id, {
      id, client, host: hostname, open: false,
      credit: INITIAL_CREDIT, consumed: 0, queue: [],
      head: head?.length ? Buffer.from(head) : null,
    })
    try {
      ws.send(JSON.stringify({ v: PROTOCOL, type: 'open', id, host: hostname, port: 443 }))
    } catch {
      streams.delete(id)
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
      onFailure()
    }
    client.on('error', () => closeStream(id, 'error'))
  })

  return {
    server,
    totals,
    /** Test helper: live stream state by id. */
    _streams: streams,
    close() {
      closed = true
      clearInterval(ping)
      failAll('shutdown')
      try { ws?.close() } catch {}
      try { server.closeAllConnections?.() } catch {}
      try { server.close() } catch {}
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href) {
  const [credsFile, portFile, bytesFile] = process.argv.slice(2)
  const creds = JSON.parse(readFileSync(credsFile, 'utf8'))
  rmSync(credsFile, { force: true })
  let save = () => {}
  const cap = Number(creds.max_bytes ?? process.env.PROXY_RELAY_MAX_BYTES)
  const maxBytes = Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_MAX_BYTES
  const { server, totals, close } = createDeviceProxyRelay({
    token: creds.token,
    wsUrl: creds.ws_url,
    maxBytes,
    maxStreams: Number(creds.max_streams) || 8,
    onFailure: () => save(),
  })
  save = () => { try { writeFileSync(bytesFile, JSON.stringify({ up: totals.up, down: totals.down, tunnels: totals.tunnels, failed: totals.failed, last_error: totals.last_error, capped: totals.capped, hosts: totals.hosts })) } catch {} }
  setInterval(save, 15_000).unref()
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { save(); close(); process.exit(0) })
  server.listen(0, '127.0.0.1', () => { writeFileSync(portFile, String(server.address().port)); save() })
}
