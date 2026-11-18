const fs = require('node:fs');
const path = require('node:path');

function observation(headers, status) {
  if (!headers) return null;
  const get = key => headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
  const names = ['limit', 'remaining', 'used', 'reset'];
  const result = { resource: String(get('x-ratelimit-resource') || ''), observed_at: new Date().toISOString(), status: Number(status) || null };
  for (const name of names) result[name] = Number(get(`x-ratelimit-${name}`));
  if (!result.resource || names.some(name => !Number.isSafeInteger(result[name]) || result[name] < 0)) return null;
  return result;
}

function attach(github, directory) {
  if (!directory) return;
  const file = path.join(directory, 'github-rate.json');
  async function save(headers, status) {
    const value = observation(headers, status);
    if (!value) return;
    try { fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(`${file}.tmp`, JSON.stringify(value)); fs.renameSync(`${file}.tmp`, file); }
    catch (error) { console.warn(`Could not record workflow API usage: ${error.message}`); }
    if (process.env.OMGITHUB_CALLBACK_TOKEN && process.env.TARGET_REPOSITORY && process.env.TRIGGER_ISSUE_NUMBER) {
      try {
        await fetch(`${process.env.OMGITHUB_ORIGIN || 'https://omgithub.com'}/api/github/${process.env.TARGET_REPOSITORY}/issues/${process.env.TRIGGER_ISSUE_NUMBER}/telemetry`, {
          method: 'POST', headers: { authorization: `Bearer ${process.env.OMGITHUB_CALLBACK_TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ run: process.env.GITHUB_RUN_ID, attempt: Number(process.env.GITHUB_RUN_ATTEMPT || 1), observed_at: value.observed_at, rate: value }),
          signal: AbortSignal.timeout(5000)
        });
      } catch { /* Reporting must not fail execution. */ }
    }
  }
  github.hook.after('request', response => save(response.headers, response.status));
  github.hook.error('request', async error => { await save(error.response?.headers || error.headers, error.status); throw error; });
}

module.exports = { attach, observation };
