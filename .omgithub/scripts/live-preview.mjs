import { readdirSync, watch } from 'node:fs'
import { join } from 'node:path'

const ignored = new Set(['.git', '.agents', '.agentsweb', '.github', '.omgithub-runtime', '.opencode', '.opencode-ssh', '.opencode-web', '.playwright-cli', 'node_modules', 'screenshots'])

export const livePreviewScript = `<script data-omgithub-live-preview>
(() => {
  const events = new EventSource('/__omgithub/live');
  events.addEventListener('change', () => {
    if (window.parent !== window) window.parent.postMessage({ type: 'omgithub:live-change' }, '*');
    else window.location.reload();
  });
  window.addEventListener('pagehide', () => events.close(), { once: true });
})();
</script>`

export function watchProject(root, changed) {
  const watchers = new Map()
  let timer
  const scan = directory => {
    try {
      if (!watchers.has(directory)) watchers.set(directory, watch(directory, () => {
        clearTimeout(timer)
        timer = setTimeout(() => { scan(directory); changed() }, 250)
      }))
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && !ignored.has(entry.name) && !entry.name.startsWith('.')) scan(join(directory, entry.name))
      }
    } catch { /* Keep serving if a directory disappears during a build. */ }
  }
  scan(root)
  return () => { clearTimeout(timer); for (const watcher of watchers.values()) watcher.close() }
}
