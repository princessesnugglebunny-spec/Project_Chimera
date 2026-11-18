const fs = require('node:fs');
const path = require('node:path');

function renderTemplate(name, values) {
  const localPath = path.join(__dirname, name);
  const sharedPath = path.join(__dirname, '..', '..', 'scripts', name);
  const templatePath = fs.existsSync(localPath) ? localPath : sharedPath;
  let body = fs.readFileSync(templatePath, 'utf8').trim();
  for (const [key, value] of Object.entries(values)) {
    body = body.replaceAll(`@${key}@`, String(value ?? ''));
  }
  return body;
}

function renderProgressComment(values) {
  return renderTemplate('opencode-progress-comment-template.md', values);
}

module.exports = { renderProgressComment, renderTemplate };
