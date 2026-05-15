import { existsSync } from 'node:fs';
import { loadConfig, resolveRepoPath } from './config.mjs';

const requestedMode = String(process.argv[2] || process.env.POSTMAN_ONBOARDING_MODE || 'auto')
  .trim()
  .toLowerCase();

if (!['auto', 'bootstrap', 'update'].includes(requestedMode)) {
  throw new Error(`Unsupported onboarding mode: ${requestedMode}`);
}

if (requestedMode !== 'auto') {
  console.log(requestedMode);
  process.exit(0);
}

const config = loadConfig();
console.log(existsSync(resolveRepoPath(config.postman.resourcesPath)) ? 'update' : 'bootstrap');
