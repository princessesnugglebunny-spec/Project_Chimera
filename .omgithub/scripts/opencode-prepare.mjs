import { appendFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseIssueRequest } from './issue-request.mjs';


export function outputText(values) {
  return Object.entries(values).map(([key, value]) => {
    let delimiter;
    do { delimiter = `opencode_${randomUUID()}`; } while (String(value).includes(delimiter));
    return `${key}<<${delimiter}\n${value}\n${delimiter}\n`;
  }).join('');
}

export async function prepareRequest(event, env, fetcher = fetch) {
  const access = String(env.OPENCODE_ACCESS || 'writers').trim().toLowerCase();
  if (!['writers', 'everyone'].includes(access)) throw new Error('Set OPENCODE_ACCESS to writers or everyone.');
  const repository = env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || event.repository?.full_name !== repository) throw new Error('Invalid issue repository.');
  const manual = env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  if (!manual && (env.GITHUB_EVENT_NAME !== 'issues' || event.action !== 'opened')) return { approved: 'false' };
  const number = Number(manual ? event.inputs?.issue_number : event.issue?.number);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Supply a valid issue number.');
  const reportRate = async response => {
    if (!env.OMGITHUB_CALLBACK_TOKEN) return
    const names = ['limit', 'remaining', 'used', 'reset']
    const rate = { resource: response.headers.get('x-ratelimit-resource'), observed_at: new Date().toISOString(), status: response.status }
    for (const name of names) {
      const value = response.headers.get(`x-ratelimit-${name}`)
      rate[name] = value === null ? NaN : Number(value)
    }
    if (!rate.resource || names.some(name => !Number.isSafeInteger(rate[name]) || rate[name] < 0)) return
    try {
      await fetch(`${env.OMGITHUB_ORIGIN || 'https://omgithub.com'}/api/github/${repository}/issues/${number}/telemetry`, {
        method: 'POST', headers: { authorization: `Bearer ${env.OMGITHUB_CALLBACK_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ run: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT || 1), observed_at: rate.observed_at, rate }),
        signal: AbortSignal.timeout(5000)
      })
    } catch { /* Keep request accounting independent of preparation. */ }
  }
  const api = async (path, options = {}) => {
    const response = await fetcher(`${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${repository}${path}`, {
      ...options, headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000), redirect: 'error',
    });
    await reportRate(response)
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const metadata = ['x-github-request-id', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after'].map(k => `${k}=${response.headers?.get(k) || 'unknown'}`).join(' ');
      const detail = String(body.message || '').replace(/[\r\n]/g, ' ').slice(0, 300);
      throw new Error(`GitHub request failed (HTTP ${response.status}) for ${path}. ${detail} ${metadata}`);
    }
    return response.status === 204 ? null : response.json();
  };
  const [repo, issue] = await Promise.all([api(''), api(`/issues/${number}`)]);
  if (issue.pull_request || issue.state !== 'open') throw new Error('Select an open issue.');
  const labels = (issue.labels || []).map(label => typeof label === 'string' ? label : label.name);
  if (!labels.includes('OpenCode')) return { approved: 'false' };
  const sender = issue.user?.login;
  if (!sender) throw new Error('The issue has no author.');
  if (access !== 'everyone') {
    const permission = await api(`/collaborators/${encodeURIComponent(sender)}/permission`);
    if (!['write', 'maintain', 'admin'].includes(permission.permission)) throw new Error('The issue author needs write, maintain, or admin access. Set OPENCODE_ACCESS=everyone to accept all authors.');
  }
  const parsed = parseIssueRequest(issue, repo.default_branch);
  if (parsed.branchError || !parsed.request || !parsed.title) throw new Error(parsed.branchError || 'Supply an issue title and request.');
  const branch = await api(`/branches/${encodeURIComponent(parsed.targetRef)}`);
  if (!/^[a-f0-9]{40}$/.test(branch.commit?.sha || '')) throw new Error('The target branch has no valid commit.');
  if (env.GITHUB_REF !== `refs/heads/${parsed.targetRef}`) {
    await api('/actions/workflows/opencode.yml/dispatches', {
      method: 'POST',
      body: JSON.stringify({ ref: parsed.targetRef, inputs: { issue_number: String(number) } }),
    });
    return { approved: 'false', redispatched: 'true' };
  }
  return { approved: 'true', issue_number: String(number), request: parsed.request, issue_title: parsed.title, sender, labels_json: JSON.stringify(labels), target_ref: parsed.targetRef, target_sha: branch.commit.sha };
}

export async function prepare(env = process.env, fetcher = fetch) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  try {
    appendFileSync(env.GITHUB_OUTPUT, outputText(await prepareRequest(event, env, fetcher)));
  } catch (error) {
    const detail = String(error.message || 'Preparation failed').replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').slice(0, 500);
    console.error(`OpenCode preparation: ${detail}`);
    const repository = env.GITHUB_REPOSITORY;
    if (/^[\w.-]+\/[\w.-]+$/.test(repository || '') && Number.isSafeInteger(event.issue?.number)) {
      await fetcher(`${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${repository}/issues/${event.issue.number}/comments`, {
        method: 'POST', headers: { Authorization: `Bearer ${env.GH_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: `OpenCode preparation failed. Check repository access and the selected branch in [the run log](https://github.com/${repository}/actions/runs/${env.GITHUB_RUN_ID}).` }),
        signal: AbortSignal.timeout(30000), redirect: 'error',
      }).catch(() => {});
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepare().catch(() => { process.exitCode = 1; });
}
