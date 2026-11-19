import { setTimeout as delay } from 'node:timers/promises'

export async function retry(operation, { signal, attempts = 3, retryable = () => true, wait = delay } = {}) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted()
    try { return await operation() }
    catch (error) {
      signal?.throwIfAborted()
      if (attempt + 1 >= attempts || !retryable(error)) throw error
      await wait(1000 * 2 ** attempt, undefined, { signal })
    }
  }
}

export async function uploadDeployment(url, options, { request = fetch, wait } = {}) {
  return retry(async () => {
    let response
    try { response = await request(url, { ...options, signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(120000)]) }) }
    catch (error) { throw Object.assign(error, { transient: true }) }
    if (!response.ok) {
      const transient = [408, 429, 500, 502, 503, 504].includes(response.status) ||
        (response.status === 403 && (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0'))
      throw Object.assign(new Error(`Deployment HTTP ${response.status}: ${await response.text()}`), { transient })
    }
    try { return await response.json() }
    catch (error) { throw Object.assign(error, { transient: true }) }
  }, { signal: options.signal, retryable: error => error.transient === true, wait })
}
