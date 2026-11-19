import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function provision(project) {
  mkdirSync(project, { recursive: true })
  const scripts = {
    'startup.sh': '#!/usr/bin/env bash\nset -euo pipefail\n',
    'start.sh': '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\n/usr/bin/time -p node "${RUNTIME_DIR:?}/scripts/default-start.mjs"\n',
    'capture.sh': '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\n/usr/bin/time -p node "${RUNTIME_DIR:?}/scripts/default-capture.mjs"\n'
  }
  for (const [name, content] of Object.entries(scripts)) {
    try { writeFileSync(join(project, name), content, { flag: 'wx', mode: 0o755 }) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) provision(process.env.PROJECT_DIR)
