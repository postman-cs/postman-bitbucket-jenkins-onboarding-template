import { execFileSync } from 'node:child_process';
import { loadConfig } from './config.mjs';

const config = loadConfig();
const contractPathPatterns = config.api.contractChangePaths.map((filePath) =>
  new RegExp(`^${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
);

function firstValue(...values) {
  return values.find((value) => String(value ?? '').trim()) ?? '';
}

function runGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
}

function hasRef(ref) {
  if (!ref) {
    return false;
  }

  try {
    runGit(['rev-parse', '--verify', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function resolveTargetRef() {
  const candidates = [
    firstValue(process.env.CHANGE_TARGET, process.env.BITBUCKET_TARGET_BRANCH),
    'origin/main',
    'main'
  ].filter(Boolean);

  for (const candidate of candidates) {
    const refs = candidate.startsWith('origin/') || candidate === 'main'
      ? [candidate]
      : [`origin/${candidate}`, candidate];

    for (const ref of refs) {
      if (hasRef(ref)) {
        return ref;
      }
    }
  }

  return '';
}

function changedFiles() {
  const targetRef = resolveTargetRef();

  if (targetRef) {
    try {
      const mergeBase = runGit(['merge-base', 'HEAD', targetRef]);
      return runGit(['diff', '--name-only', `${mergeBase}...HEAD`])
        .split('\n')
        .filter(Boolean);
    } catch {
      // Fall through to the most recent commit diff.
    }
  }

  return runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])
    .split('\n')
    .filter(Boolean);
}

const files = changedFiles();
const hasContractChanges = files.some((filePath) =>
  contractPathPatterns.some((pattern) => pattern.test(filePath))
);

if (process.argv.includes('--list')) {
  for (const filePath of files) {
    console.log(filePath);
  }
} else {
  console.log(hasContractChanges ? 'true' : 'false');
}
