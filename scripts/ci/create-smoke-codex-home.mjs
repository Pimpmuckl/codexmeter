import { createSmokeCodexHome } from './smoke-codex-home.js';

const targetDir = process.argv[2];

if (!targetDir) {
  console.error('Usage: node scripts/ci/create-smoke-codex-home.mjs <target-dir>');
  process.exit(1);
}

await createSmokeCodexHome(targetDir);
console.log(`Created smoke Codex home at ${targetDir}`);
