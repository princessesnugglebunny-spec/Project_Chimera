const { join } = require('node:path')
try {
  if (process.env.OMGITHUB_CAPTURE_WEB_DIR || process.env.OPENCODE_WEB_DIR) {
    const runtime = process.env.OMGITHUB_PLAYWRIGHT_ROOT || __dirname
    const core = require(require.resolve('playwright-core', { paths: [join(runtime, 'node_modules/@playwright/cli')] }))
    require('./wip-screenshots.cjs').instrument(core, { ...process.env,
      OMGITHUB_BROWSER_SESSION: process.argv[1]?.endsWith('cliDaemon.js') ? process.argv[2] || '' : process.env.OMGITHUB_BROWSER_SESSION || '' })
  }
} catch (error) { console.error('WIP screenshot instrumentation unavailable:', error.message) }
