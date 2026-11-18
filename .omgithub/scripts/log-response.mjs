import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createV2Client } from './opencode-v2-api.mjs'
export async function collectLogResponse({ sessionId, api }) {
  const session = await api.export(sessionId)
  return session.messages
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env
  const sessionId = readFileSync(join(env.OPENCODE_WEB_DIR, 'checkpoint-session-id'), 'utf8').trim()
  const messages = await collectLogResponse({ sessionId, api: createV2Client({ base: `http://127.0.0.1:${env.OPENCODE_WEB_PORT}`, password: env.OPENCODE_PASSWORD }) })
  if (!Array.isArray(messages) || !messages.length) throw new Error('No diagnostic response available')
  writeFileSync(process.argv[2], JSON.stringify(messages))
}
