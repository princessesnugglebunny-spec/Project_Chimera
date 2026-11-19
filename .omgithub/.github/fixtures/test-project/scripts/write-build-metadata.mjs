import { writeFile } from 'node:fs/promises';

const [output, runId, issue, repository] = process.argv.slice(2);
await writeFile(output, `${JSON.stringify({ status: 'verified', repository, issue, runId }, null, 2)}\n`);
