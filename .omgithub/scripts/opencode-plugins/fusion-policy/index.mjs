// Companion-runner plugin artifact. A2 web deployment does not install runner plugins.
export const FUSION_RUNNER_POLICY = Object.freeze({ compactionAttempts: 3, compactionMs: 300000, writeChunkChars: 12000 })
export const LARGE_FILE_GUIDANCE = 'For large files, first write a small working skeleton, then use focused edits or append chunks of at most 12000 characters. Never send an entire large game in one write-tool call. Each tool argument must finish within the model output budget. After an output-length failure, switch to smaller chunks or edits rather than retrying the same giant write. Validate syntax and the final file after the last chunk.'
export function createFusionRunnerPolicy({ now = Date.now, log = message => console.warn(message), upstream = process.env.FUSION_UPSTREAM || '' } = {}) {
  const operations = new Map(), provider = 'copilot-fusion-direct'
  const start = id => { const value = { attempts: 0, started: now() }; operations.delete(id); operations.set(id, value); while (operations.size > 512) operations.delete(operations.keys().next().value); return value }
  const isFusion = event => event.model?.providerID === provider
  return {
    id: 'omgithub.fusion-runner-policy',
    async setup(context) {
      await context.session.hook('context', event => {
        if (!isFusion(event)) return
        if (!event.system.some(part => part.text === LARGE_FILE_GUIDANCE)) event.system.push({ type: 'text', text: LARGE_FILE_GUIDANCE })
        for (const [name, tool] of Object.entries(event.tools || {})) if (/write|edit|patch/.test(name) && !tool.description.includes(LARGE_FILE_GUIDANCE)) tool.description += '\n' + LARGE_FILE_GUIDANCE
      }, { providerID: provider })
      await context.session.hook('compaction', event => { if (isFusion(event)) start(event.sessionID) }, { providerID: provider })
      await context.session.hook('http.request', event => {
        if (!isFusion(event)) return
        try {
          const proxy = new URL(upstream)
          if (proxy.pathname.startsWith('/api/fusion-pool') && new URL(event.request.url).origin === proxy.origin && ['primary', 'title', 'compaction', 'generate'].includes(event.kind)) {
            const headers = new Headers(event.request.headers); headers.set('x-fusion-request-kind', event.kind)
            event.request = new Request(event.request, { headers })
          }
        } catch {}
        if (event.kind === 'primary') { operations.delete(event.sessionID); return }
        if (event.kind !== 'compaction') return
        const operation = operations.get(event.sessionID) || start(event.sessionID)
        const remaining = FUSION_RUNNER_POLICY.compactionMs - (now() - operation.started)
        if (operation.attempts >= FUSION_RUNNER_POLICY.compactionAttempts || remaining <= 0) {
          event.request = new Request(event.request, { signal: AbortSignal.abort(new DOMException('Fusion compaction retry/time budget exhausted.', 'AbortError')) })
          log('[fusion-policy] Compaction retry/time budget exhausted; blocking additional upstream request.')
          return
        }
        operation.attempts++; operation.agent = event.agent
        event.request = new Request(event.request, { signal: AbortSignal.any([event.request.signal, AbortSignal.timeout(remaining)]) })
        log(`[fusion-policy] Compaction attempt ${operation.attempts}/${FUSION_RUNNER_POLICY.compactionAttempts}; operation deadline ${FUSION_RUNNER_POLICY.compactionMs / 1000}s.`)
      }, { providerID: provider })
      await context.session.hook('http.response', event => {
        if (!isFusion(event) || event.kind !== 'compaction') return
        const operation = operations.get(event.sessionID)
        if (event.response.ok) return
        if (operation && (operation.attempts >= FUSION_RUNNER_POLICY.compactionAttempts || now() - operation.started >= FUSION_RUNNER_POLICY.compactionMs)) {
          void event.response.body?.cancel().catch(() => {})
          event.response = Response.json({ error: { type: 'invalid_request_error', code: 'compaction_retry_exhausted', message: 'Fusion compaction stopped: retry/time budget exhausted. Start a new turn or reduce the conversation.' } }, { status: 422 })
          log('[fusion-policy] Compaction retry/time budget exhausted; returning visible non-retryable failure.')
        }
      }, { providerID: provider })
      await context.session.hook('retry', event => {
        if (!isFusion(event)) return
        const operation = operations.get(event.sessionID)
        if (operation && operation.agent === event.agent && (operation.attempts >= FUSION_RUNNER_POLICY.compactionAttempts || now() - operation.started >= FUSION_RUNNER_POLICY.compactionMs)) event.decision = { retry: false }
      }, { providerID: provider })
      return () => operations.clear()
    }
  }
}
export default createFusionRunnerPolicy()
