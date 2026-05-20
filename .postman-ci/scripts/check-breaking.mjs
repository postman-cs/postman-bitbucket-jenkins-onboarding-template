import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { loadConfig, resolveRepoPath } from './config.mjs';

function parseArgs(argv) {
  const args = {
    summary: 'openapi-changes-summary.md',
    log: 'openapi-changes.log'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--summary') {
      args.summary = next;
      index += 1;
    } else if (arg === '--log') {
      args.log = next;
      index += 1;
    }
  }

  return args;
}

function firstValue(...values) {
  return values.find((value) => String(value ?? '').trim()) ?? '';
}

function normalizeBranch(value) {
  let branchName = String(value || 'main').trim();
  if (branchName.startsWith('origin/')) {
    branchName = branchName.slice('origin/'.length);
  }
  if (branchName.startsWith('refs/heads/')) {
    branchName = branchName.slice('refs/heads/'.length);
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branchName)) {
    throw new Error(`Unsupported target branch name: ${branchName}`);
  }
  return branchName || 'main';
}

function isPullRequestBuild() {
  return Boolean(firstValue(process.env.CHANGE_ID, process.env.BITBUCKET_PULL_REQUEST_ID));
}

function gitObjectExists(refSpec) {
  try {
    execFileSync('git', ['cat-file', '-e', refSpec], {
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return true;
  } catch {
    return false;
  }
}

function writeReport({ summaryPath, logPath, title, status, source, body = '', log = '' }) {
  const lines = [
    `# ${title}`,
    '',
    `Status: ${status}`
  ];
  if (source) {
    lines.push(`Comparison: ${source}`);
  }
  if (body.trim()) {
    lines.push('', body.trim());
  }

  const report = `${lines.join('\n')}\n`;
  writeFileSync(summaryPath, report);
  writeFileSync(logPath, log);
  console.log(report.trim());
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

function comparisonSource(config) {
  const mode = config.governance.breakingChangeMode;
  if (mode === 'off') {
    return {
      skipped: true,
      reason: 'Breaking-change check is disabled by governance.breakingChangeMode=off.'
    };
  }

  if (mode !== 'baseline-only' && isPullRequestBuild()) {
    const targetBranch = normalizeBranch(firstValue(
      process.env.CHANGE_TARGET,
      process.env.BITBUCKET_TARGET_BRANCH,
      'main'
    ));
    const targetRef = `origin/${targetBranch}:${config.api.specPath}`;
    if (gitObjectExists(targetRef)) {
      return {
        previous: targetRef,
        current: config.api.specPath,
        label: `${targetRef} -> ${config.api.specPath}`
      };
    }
  }

  if (config.api.baselineSpecPath) {
    const baselinePath = resolveRepoPath(config.api.baselineSpecPath);
    if (existsSync(baselinePath)) {
      return {
        previous: config.api.baselineSpecPath,
        current: config.api.specPath,
        label: `${config.api.baselineSpecPath} -> ${config.api.specPath}`
      };
    }
  }

  return {
    skipped: true,
    reason: mode === 'baseline-only'
      ? `No baseline spec found at ${config.api.baselineSpecPath || '(empty)'}; skipping breaking-change check.`
      : `No PR target-branch spec or baseline spec found; skipping breaking-change check.`
  };
}

function runOpenApiChanges(previous, current) {
  return spawnSync('openapi-changes', [
    'summary',
    '--markdown',
    '--no-logo',
    '--no-color',
    '--with-lines',
    previous,
    current
  ], {
    encoding: 'utf8'
  });
}

const args = parseArgs(process.argv.slice(2));
const config = loadConfig();
const currentPath = resolveRepoPath(config.api.specPath);

if (!existsSync(currentPath)) {
  writeReport({
    summaryPath: args.summary,
    logPath: args.log,
    title: 'OpenAPI Breaking Change Check',
    status: 'failed',
    source: config.api.specPath,
    body: `Current spec does not exist at \`${config.api.specPath}\`.`
  });
  process.exit(1);
}

const source = comparisonSource(config);
if (source.skipped) {
  writeReport({
    summaryPath: args.summary,
    logPath: args.log,
    title: 'OpenAPI Breaking Change Check',
    status: 'skipped',
    source: '',
    body: source.reason
  });
  process.exit(0);
}

const result = runOpenApiChanges(source.previous, source.current);
const stdout = stripAnsi(result.stdout);
const stderr = stripAnsi(result.stderr);
const status = result.status ?? (result.error ? 1 : 0);
const combinedLog = [
  result.error ? `openapi-changes failed to start: ${result.error.message}` : '',
  stderr.trim()
].filter(Boolean).join('\n\n');

if (status === 0) {
  writeReport({
    summaryPath: args.summary,
    logPath: args.log,
    title: 'OpenAPI Breaking Change Check',
    status: 'passed',
    source: source.label,
    body: stdout || 'No breaking changes detected.',
    log: combinedLog
  });
  process.exit(0);
}

writeReport({
  summaryPath: args.summary,
  logPath: args.log,
  title: 'OpenAPI Breaking Change Check',
  status: 'failed',
  source: source.label,
  body: stdout || 'openapi-changes did not return a summary. Check `openapi-changes.log` for details.',
  log: combinedLog
});

process.exit(1);
