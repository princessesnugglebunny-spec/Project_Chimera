import { recoverMacDns } from './mac-dns-recovery.mjs'

// Always verify HTTPS through normal system DNS, including after cache repair.
export async function publicUrlReady(url, request = fetch, recover = recoverMacDns) {
  if (!url) return false
  try {
    if (new URL(url).protocol !== 'https:') return false
    const get = () => request(url, { signal: AbortSignal.timeout(4000), redirect: 'error' })
    let response
    try { response = await get() }
    catch (error) {
      if (!await recover(new URL(url).hostname, error)) return false
      response = await get()
    }
    const ready = response.ok
    await response.body?.cancel()
    return ready
  } catch { return false }
}

export async function readyPublicUrls(urls, check = publicUrlReady) {
  const entries = await Promise.all(['opencode', 'files', 'preview'].map(async key =>
    [key, urls[key] && await check(urls[key]) ? urls[key] : '']))
  return { ...urls, ...Object.fromEntries(entries) }
}
