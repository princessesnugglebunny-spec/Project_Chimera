function projectUrl(env = process.env) {
  const origin = (env.OMGITHUB_ORIGIN || 'https://omgithub.com').replace(/\/$/, '');
  return `${origin}/${env.GITHUB_REPOSITORY}/issues/${env.TRIGGER_ISSUE_NUMBER}`;
}

function projectLink(env = process.env) {
  return `[Open project](${projectUrl(env)})`;
}

module.exports = { projectUrl, projectLink };
