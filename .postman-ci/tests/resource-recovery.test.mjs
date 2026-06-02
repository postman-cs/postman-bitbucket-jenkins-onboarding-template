import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const ciRoot = path.resolve(testDir, '..');
const repoRoot = path.resolve(ciRoot, '..');
const onboardingModeScript = path.join(ciRoot, 'scripts/onboarding-mode.mjs');
const resourceEnvScript = path.join(ciRoot, 'scripts/postman-resource-env.mjs');

async function createFixture() {
  return mkdtemp(path.join(os.tmpdir(), 'postman-ci-resources-'));
}

async function writeResources(cwd, content) {
  await mkdir(path.join(cwd, '.postman'), { recursive: true });
  await writeFile(path.join(cwd, '.postman/resources.yaml'), content, 'utf8');
}

function runNode(scriptPath, args, options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env
    },
    encoding: 'utf8'
  });
}

const completeResources = `
workspace:
  id: ws-123
cloudResources:
  specs:
    ../api/openapi.yaml: spec-123
  collections:
    ../postman/collections/[Baseline] sample-api: baseline-123
    ../postman/collections/[Smoke] sample-api: smoke-123
    ../postman/collections/[Contract] sample-api: contract-123
  environments:
    ../postman/environments/TEST.postman_environment.json: test-env-123
    ../postman/environments/STAGE.postman_environment.json: stage-env-123
`;

test('auto mode bootstraps when resources file is absent', async () => {
  const cwd = await createFixture();
  const result = runNode(onboardingModeScript, ['auto'], { cwd });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'bootstrap');
});

test('auto mode updates when resources file has the required update seed values', async () => {
  const cwd = await createFixture();
  await writeResources(cwd, completeResources);

  const result = runNode(onboardingModeScript, ['auto'], { cwd });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'update');
});

test('auto mode bootstraps when resources file is missing spec mapping', async () => {
  const cwd = await createFixture();
  await writeResources(cwd, completeResources.replace(/  specs:\n    \.\.\/api\/openapi\.yaml: spec-123\n/, ''));

  const result = runNode(onboardingModeScript, ['auto'], { cwd });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'bootstrap');
  assert.match(result.stderr, /missing required Postman resource values: spec/i);
});

test('auto mode bootstraps when resources file is malformed', async () => {
  const cwd = await createFixture();
  await writeResources(cwd, 'workspace:\n  id: [broken\n');

  const result = runNode(onboardingModeScript, ['auto'], { cwd });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'bootstrap');
  assert.match(result.stderr, /unable to read Postman resources/i);
});

test('explicit update remains strict about mode selection', async () => {
  const cwd = await createFixture();
  await writeResources(cwd, completeResources.replace(/    \.\.\/postman\/collections\/\[Smoke\] sample-api: smoke-123\n/, ''));

  const result = runNode(onboardingModeScript, ['update'], { cwd });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'update');
});

test('non-strict resource env tolerates malformed resources and emits empty values', async () => {
  const cwd = await createFixture();
  await writeResources(cwd, 'workspace:\n  id: [broken\n');

  const result = runNode(resourceEnvScript, [], { cwd });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /unable to read Postman resources/i);
  assert.match(result.stdout, /^POSTMAN_WORKSPACE_ID=''$/m);
});

test('strict resource env resolves required environment values without exported environment list', async () => {
  const cwd = await createFixture();
  await writeResources(cwd, completeResources);

  const result = runNode(resourceEnvScript, ['--require=contract,smoke,test,stage'], {
    cwd,
    env: { POSTMAN_CI_ENVIRONMENTS_JSON: '' }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^POSTMAN_TEST_ENVIRONMENT_ID='test-env-123'$/m);
  assert.match(result.stdout, /^POSTMAN_STAGE_ENVIRONMENT_ID='stage-env-123'$/m);
});

test('strict resource env fails with missing required values', async () => {
  const cwd = await createFixture();
  await writeResources(cwd, completeResources.replace(/  specs:\n    \.\.\/api\/openapi\.yaml: spec-123\n/, ''));

  const result = runNode(resourceEnvScript, ['--require=workspace,spec,baseline,smoke,contract'], { cwd });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required Postman resource values: spec/);
});

test('Jenkins repo-sync CLI receives configured environment names and runtime URLs', async () => {
  const jenkinsfile = await readFile(path.join(repoRoot, 'Jenkinsfile'), 'utf8');

  assert.match(jenkinsfile, /--environments-json\s+"\$POSTMAN_CI_ENVIRONMENTS_JSON"/);
  assert.match(jenkinsfile, /--env-runtime-urls-json\s+"\$POSTMAN_CI_RUNTIME_URLS_JSON"/);
  assert.match(jenkinsfile, /'--environments-json',\s*\$env:POSTMAN_CI_ENVIRONMENTS_JSON,/);
  assert.match(jenkinsfile, /'--env-runtime-urls-json',\s*\$env:POSTMAN_CI_RUNTIME_URLS_JSON,/);
});

test('Jenkins repo-sync CLI can link workspaces and sync system environments', async () => {
  const jenkinsfile = await readFile(path.join(repoRoot, 'Jenkinsfile'), 'utf8');

  assert.match(jenkinsfile, /booleanParam\(name: 'POSTMAN_WORKSPACE_LINK_ENABLED'/);
  assert.match(jenkinsfile, /booleanParam\(name: 'POSTMAN_ENVIRONMENT_SYNC_ENABLED'/);
  assert.match(jenkinsfile, /text\(name: 'POSTMAN_SYSTEM_ENV_MAP_JSON'/);
  assert.match(jenkinsfile, /--repo-url\s+"\$BITBUCKET_HTTPS_REMOTE_URL"/);
  assert.match(jenkinsfile, /--workspace-link-enabled\s+"\$POSTMAN_WORKSPACE_LINK_ENABLED"/);
  assert.match(jenkinsfile, /--environment-sync-enabled\s+"\$POSTMAN_ENVIRONMENT_SYNC_ENABLED"/);
  assert.match(jenkinsfile, /--system-env-map-json\s+"\$POSTMAN_SYSTEM_ENV_MAP_JSON"/);
  assert.match(jenkinsfile, /'--repo-url',\s*\$env:BITBUCKET_HTTPS_REMOTE_URL,/);
  assert.match(jenkinsfile, /'--workspace-link-enabled',\s*\$env:POSTMAN_WORKSPACE_LINK_ENABLED,/);
  assert.match(jenkinsfile, /'--environment-sync-enabled',\s*\$env:POSTMAN_ENVIRONMENT_SYNC_ENABLED,/);
  assert.match(jenkinsfile, /'--system-env-map-json',\s*\$env:POSTMAN_SYSTEM_ENV_MAP_JSON,/);
});
