import { execFileSync } from 'node:child_process';

function envOrDefault(name, defaultValue) {
  return String(process.env[name] ?? '').trim() || defaultValue;
}

const expectedSubject = envOrDefault(
  'POSTMAN_GENERATED_ARTIFACT_COMMIT_MESSAGE',
  'chore: sync Postman artifacts and metadata'
);
const expectedAuthorName = envOrDefault('POSTMAN_CSE_AUTHOR', 'Postman CSE');
const expectedAuthorEmail = envOrDefault('POSTMAN_CSE_AUTHOR_EMAIL', 'help@postman.com');
const explain = process.argv.includes('--explain');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function result(matches, reason, details = {}) {
  if (explain) {
    console.log(JSON.stringify({ matches, reason, ...details }, null, 2));
  } else {
    console.log(matches ? 'true' : 'false');
  }
}

let metadata;
try {
  metadata = git(['log', '-1', '--pretty=%s%n%an%n%ae']).split(/\r?\n/);
} catch (error) {
  result(false, 'Unable to read last commit metadata.');
  process.exit(0);
}

const [subject = '', authorName = '', authorEmail = ''] = metadata;
if (subject !== expectedSubject) {
  result(false, 'Commit subject does not match generated artifact commit message.', {
    subject,
    expectedSubject
  });
  process.exit(0);
}

if (authorName !== expectedAuthorName || authorEmail !== expectedAuthorEmail) {
  result(false, 'Commit author does not match generated artifact author.', {
    authorName,
    authorEmail,
    expectedAuthorName,
    expectedAuthorEmail
  });
  process.exit(0);
}

let parentCount = 0;
try {
  parentCount = git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/).slice(1).length;
} catch (error) {
  result(false, 'Unable to read last commit parents.');
  process.exit(0);
}

if (parentCount !== 1) {
  result(false, 'Generated artifact commits must be single-parent commits.', {
    parentCount
  });
  process.exit(0);
}

let changedPaths = [];
try {
  changedPaths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
} catch (error) {
  result(false, 'Unable to read changed paths.');
  process.exit(0);
}

if (changedPaths.length === 0) {
  result(false, 'Commit has no changed paths.');
  process.exit(0);
}

const allowedPathPrefixes = ['.postman/', 'postman/'];
const unexpectedPaths = changedPaths.filter((path) => {
  return !allowedPathPrefixes.some((prefix) => path.startsWith(prefix));
});

if (unexpectedPaths.length > 0) {
  result(false, 'Commit changes files outside generated Postman artifact paths.', {
    unexpectedPaths
  });
  process.exit(0);
}

result(true, 'Commit only contains generated Postman artifacts.', {
  changedPaths
});
