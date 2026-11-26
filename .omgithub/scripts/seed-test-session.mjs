import { randomBytes } from 'node:crypto'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { command, exportSession } from './session-checkpoint.mjs'
const env = process.env, binary = env.OPENCODE_BIN || join(env.HOME, '.opencode/bin/opencode')
const base = `http://127.0.0.1:${env.OPENCODE_WEB_PORT}`
const headers = { authorization: `Basic ${Buffer.from(`opencode:${env.OPENCODE_PASSWORD}`).toString('base64')}`, 'content-type': 'application/json' }
const response = await fetch(`${base}/api/session`, { method: 'POST', headers, body: JSON.stringify({ location: { directory: env.PROJECT_DIR } }) })
if (!response.ok) throw new Error(`Create fixture session HTTP ${response.status}`)
const { data: info } = await response.json()
const exported = await fetch(`${base}/api/experimental/session/${info.id}/export`, { headers })
if (!exported.ok) throw new Error(`Export fixture session HTTP ${exported.status}`)
const { data: session } = await exported.json()
const id = prefix => `${prefix}_${randomBytes(12).toString('hex')}`
const now = Date.now(), assistant = id('msg')
session.messages = [
  { type: 'idle', outcome: 'succeeded' },
  { type: 'assistant', id: assistant, time: { created: now, completed: now + 1 }, agent: 'build', model: { providerID: 'fixture', id: 'fixture' }, content: [{ type: 'text', id: id('prt'), text: 'Fixture copied. Validate and publish through the production Git pipeline.' }] },
  { type: 'user', id: id('msg'), time: { created: now - 1 }, text: env.COMMENT_BODY || 'Build fixture' }
]
const file = join(env.OPENCODE_WEB_DIR, 'synthetic-session.json')
writeFileSync(file, JSON.stringify(session), { mode: 0o600 })
try {
  command(binary, ['session', 'import', file, '--standalone', '--directory', env.PROJECT_DIR], { cwd: env.PROJECT_DIR })
  const saved = exportSession(binary, info.id, env.PROJECT_DIR, env.RUNNER_TEMP)
  if (!saved.messages.some(message => message.id === assistant)) throw new Error('Fixture session import failed')
  writeFileSync(join(env.OPENCODE_WEB_DIR, 'synthetic-session-id'), info.id)
  writeFileSync(join(env.OPENCODE_WEB_DIR, 'opencode-run.exit'), '0')
} finally { rmSync(file, { force: true }) }
