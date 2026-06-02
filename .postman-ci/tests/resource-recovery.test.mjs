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
const resolveRuntimeEnvScript = path.join(ciRoot, 'scripts/resolve-runtime-env.mjs');
const repoSyncDiagnosticsScript = path.join(ciRoot, 'scripts/report-repo-sync-diagnostics.mjs');

async function createFixture() {
  return mkdtemp(path.join(os.tmpdir(), 'postman-ci-resources-'));
}

async function writeResources(cwd, content) {
  await mkdir(path.join(cwd, '.postman'), { recursive: true });
  await writeFile(path.join(cwd, '.postman/resources.yaml'), content, 'utf8');
}

async function writeJson(cwd, filePath, content) {
  await writeFile(path.join(cwd, filePath), JSON.stringify(content, null, 2), 'utf8');
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
  assert.match(result.stderr, /Postman resource diagnostics/);
  assert.match(result.stderr, /resources path: \.postman\/resources\.yaml/);
  assert.match(result.stderr, /resources file exists: true/);
  assert.match(result.stderr, /available collections: .*Baseline.*Smoke.*Contract/);
  assert.match(result.stderr, /available environments: .*TEST\.postman_environment\.json.*STAGE\.postman_environment\.json/);
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
  assert.match(jenkinsfile, /booleanParam\(name: 'POSTMAN_ENVIRONMENT_SYNC_ENABLED', defaultValue: true/);
  assert.match(jenkinsfile, /text\(name: 'POSTMAN_SYSTEM_ENV_MAP_JSON'/);
  assert.match(jenkinsfile, /--repo-url\s+"\$BITBUCKET_HTTPS_REMOTE_URL"/);
  assert.match(jenkinsfile, /--workspace-link-enabled\s+"\$POSTMAN_WORKSPACE_LINK_ENABLED"/);
  assert.match(jenkinsfile, /--environment-sync-enabled\s+"\$POSTMAN_ENVIRONMENT_SYNC_ENABLED"/);
  assert.match(jenkinsfile, /--system-env-map-json\s+"\$POSTMAN_CI_SYSTEM_ENV_MAP_JSON"/);
  assert.match(jenkinsfile, /'--repo-url',\s*\$env:BITBUCKET_HTTPS_REMOTE_URL,/);
  assert.match(jenkinsfile, /'--workspace-link-enabled',\s*\$env:POSTMAN_WORKSPACE_LINK_ENABLED,/);
  assert.match(jenkinsfile, /'--environment-sync-enabled',\s*\$env:POSTMAN_ENVIRONMENT_SYNC_ENABLED,/);
  assert.match(jenkinsfile, /'--system-env-map-json',\s*\$env:POSTMAN_CI_SYSTEM_ENV_MAP_JSON,/);
  assert.equal(
    jenkinsfile.match(/node \.postman-ci\/scripts\/report-repo-sync-diagnostics\.mjs postman-repo-sync-result\.json/g)?.length,
    2
  );
});

test('Jenkins push stage diagnoses Bitbucket credential access before push', async () => {
  const jenkinsfile = await readFile(path.join(repoRoot, 'Jenkinsfile'), 'utf8');

  assert.equal(jenkinsfile.match(/Bitbucket push diagnostics/g)?.length, 2);
  assert.match(jenkinsfile, /credential ID: \$\{BITBUCKET_CREDENTIALS_ID:-unknown\}/);
  assert.match(jenkinsfile, /credential username present:/);
  assert.match(jenkinsfile, /credential username is API token auth user:/);
  assert.match(jenkinsfile, /credential password present:/);
  assert.match(jenkinsfile, /repository slug: \$BITBUCKET_REPOSITORY_SLUG/);
  assert.match(jenkinsfile, /https remote host:/);
  assert.match(jenkinsfile, /authenticated ls-remote heads: success/);
  assert.match(jenkinsfile, /authenticated ls-remote heads: failed/);
  assert.match(jenkinsfile, /\$env:BITBUCKET_CREDENTIALS_ID = /);
  assert.match(jenkinsfile, /credential username is API token auth user: \{0\}/);
});

test('runtime env resolves system environment aliases to configured names', () => {
  const result = runNode(resolveRuntimeEnvScript, [], {
    cwd: repoRoot,
    env: {
      POSTMAN_RUNTIME_URLS_JSON: '{"TEST":"http://localhost:3000","STAGE":"https://stage.example.com","PROD":"https://api.example.com"}',
      POSTMAN_SYSTEM_ENV_MAP_JSON: '{"testing":"test-id","staging":"stage-id","production":"prod-id"}'
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /^POSTMAN_CI_SYSTEM_ENV_MAP_JSON='\{"TEST":"test-id","STAGE":"stage-id","PROD":"prod-id"\}'$/m
  );
  assert.match(result.stderr, /Postman runtime configuration/);
  assert.match(result.stderr, /environments: TEST, STAGE, PROD/);
  assert.match(result.stderr, /contract environment: TEST/);
  assert.match(result.stderr, /smoke environment: STAGE/);
  assert.match(result.stderr, /discovered system environments: testing, staging, production/);
  assert.match(result.stderr, /discovered system environment count: 3/);
  assert.match(result.stderr, /system environment mappings: TEST=configured, STAGE=configured, PROD=configured/);
});

test('runtime env prefers exact system environment map keys over aliases', () => {
  const result = runNode(resolveRuntimeEnvScript, [], {
    cwd: repoRoot,
    env: {
      POSTMAN_RUNTIME_URLS_JSON: '{"TEST":"http://localhost:3000"}',
      POSTMAN_SYSTEM_ENV_MAP_JSON: '{"testing":"alias-id","test":"case-id","TEST":"exact-id"}',
      POSTMAN_SMOKE_ENVIRONMENT: 'TEST'
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^POSTMAN_CI_SYSTEM_ENV_MAP_JSON='\{"TEST":"exact-id"\}'$/m);
});

test('repo-sync diagnostics explain skipped integration statuses', async () => {
  const cwd = await createFixture();
  await writeJson(cwd, 'postman-repo-sync-result.json', {
    'workspace-link-status': 'skipped',
    'environment-sync-status': 'skipped',
    'environment-uids-json': '{"TEST":"test-env-123","STAGE":"stage-env-123"}',
    'repo-sync-summary-json': '{"commitSha":"abc123","environmentCount":2,"pushed":false}',
    'commit-sha': 'abc123',
    'mock-url': 'https://example.mock.pstmn.io',
    'monitor-id': ''
  });

  const result = runNode(repoSyncDiagnosticsScript, ['postman-repo-sync-result.json'], {
    cwd,
    env: {
      POSTMAN_WORKSPACE_LINK_ENABLED: 'false',
      POSTMAN_ENVIRONMENT_SYNC_ENABLED: 'true',
      POSTMAN_CI_SYSTEM_ENV_MAP_JSON: '{}',
      POSTMAN_REPO_WRITE_MODE: 'commit-and-push'
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Postman repo-sync diagnostics/);
  assert.match(result.stdout, /workspace-link-status: skipped/);
  assert.match(result.stdout, /workspace link skipped because POSTMAN_WORKSPACE_LINK_ENABLED=false/);
  assert.match(result.stdout, /environment-sync-status: skipped/);
  assert.match(result.stdout, /environment sync skipped because POSTMAN_CI_SYSTEM_ENV_MAP_JSON has no mappings/);
  assert.match(result.stdout, /environment count: 2/);
  assert.match(result.stdout, /system environment mapping count: 0/);
  assert.match(result.stdout, /system environment mappings: \(none\)/);
  assert.match(result.stdout, /mock URL: present/);
  assert.match(result.stdout, /monitor ID: missing/);
  assert.doesNotMatch(result.stdout, /example\.mock\.pstmn\.io/);
});
