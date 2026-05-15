import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { loadConfig, powerShellQuote, resolveRepoPath, shellQuote } from './config.mjs';

function parseArgs(argv) {
  const required = new Set();
  let format = 'sh';

  for (const arg of argv) {
    if (arg.startsWith('--format=')) {
      format = arg.slice('--format='.length).trim();
      continue;
    }

    if (!arg.startsWith('--require=')) {
      continue;
    }

    for (const key of arg.slice('--require='.length).split(',')) {
      const normalizedKey = key.trim().toLowerCase();
      if (normalizedKey) {
        required.add(normalizedKey);
      }
    }
  }

  if (!['sh', 'ps1'].includes(format)) {
    throw new Error(`Unsupported output format: ${format}`);
  }

  return { required, format };
}

function findValueByPathFragment(values, fragment) {
  return Object.entries(values).find(([filePath]) => filePath.includes(fragment))?.[1] ?? '';
}

const config = loadConfig();
const { required, format } = parseArgs(process.argv.slice(2));
const resourcesPath = resolveRepoPath(config.postman.resourcesPath);
const resources = existsSync(resourcesPath)
  ? YAML.parse(await readFile(resourcesPath, 'utf8')) ?? {}
  : {};
const cloudResources = resources.cloudResources ?? {};
const collections = cloudResources.collections ?? {};
const environments = cloudResources.environments ?? {};
const specs = cloudResources.specs ?? {};
const environmentNames = (() => {
  const rawValue = String(process.env.POSTMAN_CI_ENVIRONMENTS_JSON ?? '').trim();
  if (!rawValue) {
    return [];
  }

  const parsed = JSON.parse(rawValue);
  if (!Array.isArray(parsed)) {
    throw new Error('POSTMAN_CI_ENVIRONMENTS_JSON must be a JSON array.');
  }

  return parsed.map((entry) => String(entry).trim()).filter(Boolean);
})();

const values = {
  workspace: String(resources.workspace?.id ?? ''),
  spec: String(
    specs[`../${config.api.specPath}`] ??
    specs[`../${config.api.bundledSpecPath}`] ??
    Object.values(specs)[0] ??
    ''
  ),
  baseline: String(findValueByPathFragment(collections, '[Baseline]')),
  smoke: String(findValueByPathFragment(collections, '[Smoke]')),
  contract: String(findValueByPathFragment(collections, '[Contract]')),
  mock: String(cloudResources.mocks?.default ?? cloudResources.mockUrl ?? ''),
  monitor: String(cloudResources.monitors?.smoke ?? cloudResources.monitorId ?? '')
};

for (const envName of environmentNames) {
  values[envName.toLowerCase()] = String(
    findValueByPathFragment(environments, `${envName}.postman_environment.json`)
  );
}

const missing = [...required].filter((key) => !values[key]);
if (missing.length > 0) {
  throw new Error(`Missing required Postman resource values: ${missing.join(', ')}`);
}

const envNames = {
  workspace: 'POSTMAN_WORKSPACE_ID',
  spec: 'POSTMAN_SPEC_ID',
  baseline: 'POSTMAN_BASELINE_COLLECTION_ID',
  smoke: 'POSTMAN_SMOKE_COLLECTION_ID',
  contract: 'POSTMAN_CONTRACT_COLLECTION_ID',
  mock: 'POSTMAN_MOCK_URL',
  monitor: 'POSTMAN_MONITOR_ID'
};

for (const envName of environmentNames) {
  envNames[envName.toLowerCase()] = `POSTMAN_${envName.toUpperCase()}_ENVIRONMENT_ID`;
}

for (const [key, envName] of Object.entries(envNames)) {
  if (format === 'ps1') {
    console.log(`$env:${envName}=${powerShellQuote(values[key])}`);
  } else {
    console.log(`${envName}=${shellQuote(values[key])}`);
  }
}
