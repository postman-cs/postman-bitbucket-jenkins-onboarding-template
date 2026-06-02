import { readFile } from 'node:fs/promises';

function parseJsonObject(rawValue, label) {
  const value = String(rawValue ?? '').trim();
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error.message}`);
  }
}

function parseBooleanEnv(name) {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] ?? '').trim().toLowerCase());
}

function formatList(values) {
  return values.length > 0 ? values.join(', ') : '(none)';
}

function valueOrMissing(value) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : 'missing';
}

const resultPath = process.argv[2] || 'postman-repo-sync-result.json';
let result;

try {
  result = JSON.parse(await readFile(resultPath, 'utf8'));
} catch (error) {
  throw new Error(`Unable to read Postman repo-sync result from ${resultPath}: ${error.message}`);
}

if (!result || typeof result !== 'object' || Array.isArray(result)) {
  throw new Error(`Postman repo-sync result at ${resultPath} must be a JSON object.`);
}

const environmentUids = parseJsonObject(result['environment-uids-json'], 'environment-uids-json');
const summary = parseJsonObject(result['repo-sync-summary-json'], 'repo-sync-summary-json');
const systemEnvMap = parseJsonObject(
  process.env.POSTMAN_CI_SYSTEM_ENV_MAP_JSON,
  'POSTMAN_CI_SYSTEM_ENV_MAP_JSON'
);
const systemEnvNames = Object.keys(systemEnvMap);
const workspaceLinkStatus = valueOrMissing(result['workspace-link-status']);
const environmentSyncStatus = valueOrMissing(result['environment-sync-status']);
const workspaceLinkEnabled = parseBooleanEnv('POSTMAN_WORKSPACE_LINK_ENABLED');
const environmentSyncEnabled = parseBooleanEnv('POSTMAN_ENVIRONMENT_SYNC_ENABLED');
const environmentCount = Object.keys(environmentUids).length || Number(summary.environmentCount ?? 0);

console.log('Postman repo-sync diagnostics');
console.log(`workspace-link-status: ${workspaceLinkStatus}`);
if (workspaceLinkStatus === 'skipped') {
  if (!workspaceLinkEnabled) {
    console.log('workspace link skipped because POSTMAN_WORKSPACE_LINK_ENABLED=false');
  } else {
    console.log('workspace link skipped; check repo URL, access token scope, and repo provider support');
  }
}

console.log(`environment-sync-status: ${environmentSyncStatus}`);
if (environmentSyncStatus === 'skipped') {
  if (!environmentSyncEnabled) {
    console.log('environment sync skipped because POSTMAN_ENVIRONMENT_SYNC_ENABLED=false');
  } else if (systemEnvNames.length === 0) {
    console.log('environment sync skipped because POSTMAN_CI_SYSTEM_ENV_MAP_JSON has no mappings');
  } else {
    console.log('environment sync skipped; verify configured system environment names match Postman environments');
  }
}

console.log(`environment count: ${environmentCount}`);
console.log(`system environment mapping count: ${systemEnvNames.length}`);
console.log(`system environment mappings: ${formatList(systemEnvNames)}`);
console.log(`commit SHA: ${valueOrMissing(result['commit-sha'] ?? summary.commitSha)}`);
console.log(`repo write mode: ${valueOrMissing(process.env.POSTMAN_REPO_WRITE_MODE)}`);
console.log(`mock URL: ${result['mock-url'] ? 'present' : 'missing'}`);
console.log(`monitor ID: ${result['monitor-id'] ? 'present' : 'missing'}`);
