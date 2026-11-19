// OpenCode v2 plugin (loaded by absolute directory path from opencode.json `plugins`).
// 1. `session.context`: keep only the newest KEEP images in the request history; older
//    screenshots become a short text note. The transform is a pure function of history, so
//    the prompt prefix only changes when a new image arrives (limits provider cache misses).
// 2. `shell.create.before`: bash-tool children never inherit the CI proxy env.
export const KEEP = Number(process.env.OMGITHUB_KEEP_IMAGES || 2)
export const NOTE = '[older screenshot removed to save context; take a new one if needed]'
export const PROXY_VARS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']

const mimeOf = part => part?.type === 'media' ? (part.media?.mediaType || part.media?.mime || part.mediaType || '')
  : part?.type === 'file' ? (part.mime || part.mediaType || '') : ''
export const isImage = part => /^image\//i.test(mimeOf(part)) || (part?.type === 'media' && !mimeOf(part))

const note = () => ({ type: 'text', text: NOTE })
function rebuild(message, content) {
  return Object.assign(Object.create(Object.getPrototypeOf(message)), message, { content })
}

// Walk newest -> oldest so the newest KEEP images survive. Returns the number replaced.
export function pruneImages(messages, keep = KEEP) {
  let seen = 0, removed = 0
  const visit = part => {
    if (!isImage(part)) return part
    seen += 1
    if (seen <= keep) return part
    removed += 1
    return note()
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!Array.isArray(message?.content)) continue
    let changed = false
    const content = [...message.content].reverse().map(part => {
      if (part?.type === 'tool-result' && part.result?.type === 'content' && Array.isArray(part.result.value)) {
        const value = [...part.result.value].reverse().map(visit).reverse()
        if (value.some((item, i) => item !== part.result.value[i])) { changed = true; return { ...part, result: { ...part.result, value } } }
        return part
      }
      const next = visit(part)
      if (next !== part) changed = true
      return next
    }).reverse()
    if (changed) messages[index] = rebuild(message, content)
  }
  return removed
}

export function stripProxyEnv(env) {
  for (const name of PROXY_VARS) delete env[name]
  return env
}

export default {
  id: 'omgithub.image-history',
  async setup(ctx) {
    await ctx.session.hook('context', event => {
      const removed = pruneImages(event.messages)
      if (removed && process.env.OMGITHUB_IMAGE_HISTORY_LOG) console.error(`[image-history] replaced ${removed} older image(s)`)
    })
    await ctx.shell.hook('create.before', event => { stripProxyEnv(event.env) })
  },
}
