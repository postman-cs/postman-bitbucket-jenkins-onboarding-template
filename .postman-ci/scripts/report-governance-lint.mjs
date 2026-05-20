import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const REPORT_MARKER = '<!-- postman-governance-report:v1 -->';
const TASK_MARKER = 'postman-governance-task:v1';
const MAX_CONSOLE_VIOLATIONS = 50;
const MAX_COMMENT_VIOLATIONS = 100;
const MAX_BREAKING_SUMMARY_CHARS = 12000;

function parseArgs(argv) {
  const args = {
    lintResults: 'lint-results.json',
    lintStderr: 'lint-stderr.log',
    lintExit: 0,
    breakingSummary: 'openapi-changes-summary.md',
    breakingLog: 'openapi-changes.log',
    breakingExit: 0
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--lint-results') {
      args.lintResults = next;
      index += 1;
    } else if (arg === '--lint-stderr') {
      args.lintStderr = next;
      index += 1;
    } else if (arg === '--lint-exit') {
      args.lintExit = Number(next || 0);
      index += 1;
    } else if (arg === '--breaking-summary') {
      args.breakingSummary = next;
      index += 1;
    } else if (arg === '--breaking-log') {
      args.breakingLog = next;
      index += 1;
    } else if (arg === '--breaking-exit') {
      args.breakingExit = Number(next || 0);
      index += 1;
    }
  }

  return args;
}

function truncateBlock(value, maxLength = MAX_BREAKING_SUMMARY_CHARS) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}\n\n_Additional breaking-change output is available in the Jenkins artifact \`openapi-changes-summary.md\`._`;
}

function readText(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return '';
  }

  const buffer = readFileSync(filePath);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le').replace(/^\uFEFF/, '');
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 200));
  const nulCount = sample.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
  if (nulCount > sample.length / 4) {
    return buffer.toString('utf16le').replace(/^\uFEFF/, '');
  }

  return buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\u0000/g, '');
}

function readJson(filePath) {
  const raw = readText(filePath).trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return {
      parseError: error.message,
      raw
    };
  }
}

function firstValue(...values) {
  return values.find((value) => String(value ?? '').trim()) ?? '';
}

function normalizeSeverity(value) {
  return String(value || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
}

function field(violation, ...names) {
  for (const name of names) {
    const value = violation?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return '';
}

function normalizeViolations(result) {
  const candidates = [
    result?.violations,
    result?.results?.violations,
    result?.summary?.violations
  ];
  const violations = candidates.find(Array.isArray) || [];

  return violations.map((violation) => ({
    severity: normalizeSeverity(field(violation, 'severity', 'level')),
    file: field(violation, 'file', 'source', 'filename'),
    line: field(violation, 'line number', 'lineNumber', 'line'),
    path: field(violation, 'path', 'jsonPath', 'location'),
    issue: field(violation, 'issue', 'message', 'description'),
    issueType: field(violation, 'issue type', 'issueType', 'type')
  }));
}

function countBySeverity(violations) {
  const counts = new Map();
  for (const violation of violations) {
    counts.set(violation.severity, (counts.get(violation.severity) || 0) + 1);
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([severity, count]) => `${severity}: ${count}`)
    .join(', ') || 'none';
}

function truncate(value, maxLength = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function tableEscape(value) {
  return String(value || '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim();
}

function markdownLink(label, url) {
  if (!url) {
    return '';
  }

  return `[${label}](${url})`;
}

function breakingStatusLabel(exitCode, summary) {
  const match = String(summary || '').match(/^Status:\s*([A-Za-z-]+)/m);
  if (match) {
    return match[1].toLowerCase();
  }
  return exitCode === 0 ? 'passed' : 'failed';
}

function currentCommit() {
  const envCommit = firstValue(process.env.GIT_COMMIT, process.env.BITBUCKET_COMMIT);
  if (envCommit) {
    return envCommit;
  }

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '';
  }
}

function parseRemoteUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!raw) {
    return '';
  }

  const sshMatch = raw.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return sshMatch[1].replace(/^\/+|\.git$/g, '');
  }

  try {
    return new URL(raw).pathname.replace(/^\/+|\.git$/g, '');
  } catch {
    return '';
  }
}

function gitRemoteUrl() {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '';
  }
}

function repositorySlug() {
  const explicitFullName = firstValue(
    process.env.BITBUCKET_REPO_FULL_NAME,
    process.env.BITBUCKET_REPOSITORY_FULL_NAME
  );
  if (explicitFullName.includes('/')) {
    return explicitFullName;
  }

  const workspace = firstValue(
    process.env.BITBUCKET_WORKSPACE,
    process.env.BITBUCKET_PROJECT_KEY,
    process.env.CHANGE_FORK_OWNER
  );
  const repoSlug = firstValue(
    process.env.BITBUCKET_REPO_SLUG,
    process.env.BITBUCKET_REPOSITORY_SLUG
  );
  if (workspace && repoSlug && !repoSlug.includes('/')) {
    return `${workspace}/${repoSlug}`;
  }
  if (repoSlug.includes('/')) {
    return repoSlug;
  }

  return parseRemoteUrl(firstValue(process.env.BITBUCKET_GIT_HTTP_ORIGIN, process.env.GIT_URL, gitRemoteUrl()));
}

function repositoryApiPath(repo) {
  const [workspace, ...repoParts] = String(repo || '').split('/');
  const repoSlug = repoParts.join('/');
  if (!workspace || !repoSlug) {
    return '';
  }

  return `${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}`;
}

function pullRequestId() {
  return firstValue(process.env.CHANGE_ID, process.env.BITBUCKET_PULL_REQUEST_ID);
}

function authHeader() {
  const bearerToken = firstValue(process.env.BITBUCKET_BEARER_TOKEN, process.env.BITBUCKET_API_TOKEN);
  if (bearerToken) {
    return `Bearer ${bearerToken}`;
  }

  const username = firstValue(process.env.BITBUCKET_USERNAME);
  const password = firstValue(process.env.BITBUCKET_APP_PASSWORD, process.env.BITBUCKET_PASSWORD);
  if (username && password) {
    return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  return '';
}

function shouldCreateTask() {
  const value = String(process.env.BITBUCKET_PR_CREATE_BLOCKING_TASK ?? 'true').trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(value);
}

function consoleSummary({ lintExit, violations, stderr, parseError, breakingExit, breakingSummary }) {
  console.log('');
  console.log('API Governance Summary');
  console.log('----------------------');
  console.log(`Lint exit code: ${lintExit}`);
  console.log(`Breaking-change exit code: ${breakingExit}`);
  console.log(`Violations: ${violations.length} (${countBySeverity(violations)})`);

  if (parseError) {
    console.log(`Could not parse lint JSON: ${parseError}`);
  }

  const shown = violations.slice(0, MAX_CONSOLE_VIOLATIONS);
  for (const violation of shown) {
    const location = [violation.file, violation.line].filter(Boolean).join(':');
    const path = violation.path ? ` ${violation.path}` : '';
    const issue = truncate(violation.issue || 'No issue text returned.');
    console.log(`- [${violation.severity}] ${location}${path}: ${issue}`);
  }

  if (violations.length > shown.length) {
    console.log(`... ${violations.length - shown.length} more violation(s) omitted from console output.`);
  }

  if (stderr.trim()) {
    console.log('');
    console.log('Postman CLI stderr');
    console.log('------------------');
    console.log(stderr.trim());
  }

  if (breakingSummary.trim()) {
    console.log('');
    console.log('OpenAPI Breaking Change Summary');
    console.log('-------------------------------');
    console.log(truncateBlock(breakingSummary, 3000));
  }
}

function markdownReport({ lintExit, violations, parseError, breakingExit, breakingSummary, breakingLog }) {
  const failed = lintExit !== 0 || breakingExit !== 0;
  const buildUrl = firstValue(process.env.BUILD_URL, process.env.RUN_DISPLAY_URL);
  const jobName = firstValue(process.env.JOB_NAME);
  const buildNumber = firstValue(process.env.BUILD_NUMBER);
  const commit = currentCommit();
  const buildLabel = jobName && buildNumber ? `${jobName} #${buildNumber}` : 'Jenkins build';
  const build = markdownLink(buildLabel, buildUrl) || buildLabel;
  const status = failed ? 'failed' : 'passed';
  const reviewMentionEmail = firstValue(process.env.POSTMAN_CI_PR_REVIEW_MENTION_EMAIL);
  const breakingStatus = breakingStatusLabel(breakingExit, breakingSummary);

  const lines = [
    REPORT_MARKER,
    `## API Governance ${status}`,
    '',
    `Jenkins build: ${build}`,
  ];
  if (commit) {
    lines.push(`Commit: \`${commit}\``);
  }
  if (reviewMentionEmail && failed) {
    lines.push(`Reviewer: ${reviewMentionEmail}`);
  }

  lines.push(
    '',
    `Postman Governance lint: **${lintExit === 0 ? 'passed' : 'failed'}**`,
    `OpenAPI breaking-change check: **${breakingStatus}**`
  );

  lines.push('', '### Postman Governance Lint', '', `Violations: **${violations.length}** (${countBySeverity(violations)})`);

  if (parseError) {
    lines.push('', `Could not parse \`lint-results.json\`: \`${parseError}\``);
  }

  if (violations.length > 0) {
    lines.push('', '| Severity | File | Line | Path | Issue |', '| --- | --- | --- | --- | --- |');
    for (const violation of violations.slice(0, MAX_COMMENT_VIOLATIONS)) {
      lines.push(
        `| ${tableEscape(violation.severity)} | ${tableEscape(violation.file)} | ${tableEscape(violation.line)} | ${tableEscape(violation.path)} | ${tableEscape(violation.issue)} |`
      );
    }
    if (violations.length > MAX_COMMENT_VIOLATIONS) {
      lines.push('', `${violations.length - MAX_COMMENT_VIOLATIONS} more violation(s) are available in the Jenkins artifact \`lint-results.json\`.`);
    }
  } else if (lintExit !== 0) {
    lines.push('', 'Postman CLI failed but did not return governance violations in the lint JSON. Check `lint-stderr.log` and the Jenkins console for details.');
  }

  lines.push('', '### OpenAPI Breaking Change Check');
  if (breakingSummary.trim()) {
    lines.push('', truncateBlock(breakingSummary));
  } else if (breakingExit !== 0) {
    lines.push('', 'The breaking-change check failed without producing a summary. Check `openapi-changes.log` in the Jenkins artifacts.');
  } else {
    lines.push('', 'No breaking-change summary was produced.');
  }
  if (breakingLog.trim() && breakingExit !== 0) {
    lines.push('', '`openapi-changes.log` contains additional diagnostic output.');
  }

  lines.push('', 'Merge blocking is enforced by the failed Jenkins build status. If your Bitbucket merge checks require all PR tasks to be resolved, the generated API Governance task also blocks merge until the next passing run resolves it.');

  return `${lines.join('\n')}\n`;
}

async function bitbucketRequest(url, { method = 'GET', body, auth }) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: auth,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }

  if (!response.ok) {
    const detail = json?.error?.message || json?.detail?.error?.message || json?.raw || text || response.statusText;
    throw new Error(`${method} ${url} failed: ${response.status} ${response.statusText} - ${detail}`);
  }

  return json;
}

async function paginatedValues(url, auth) {
  const values = [];
  let nextUrl = url;
  while (nextUrl) {
    const page = await bitbucketRequest(nextUrl, { auth });
    if (Array.isArray(page.values)) {
      values.push(...page.values);
    }
    nextUrl = page.next || '';
  }

  return values;
}

async function upsertReportComment({ repo, prId, auth, body }) {
  const repoPath = repositoryApiPath(repo);
  if (!repoPath) {
    throw new Error(`Invalid Bitbucket repository slug: ${repo}`);
  }

  const commentsUrl = `https://api.bitbucket.org/2.0/repositories/${repoPath}/pullrequests/${encodeURIComponent(prId)}/comments`;
  const comments = await paginatedValues(`${commentsUrl}?pagelen=100`, auth);
  const existing = comments.find((comment) =>
    !comment.deleted && String(comment?.content?.raw || '').includes(REPORT_MARKER)
  );
  const payload = {
    content: {
      raw: body
    }
  };

  if (existing?.id) {
    return bitbucketRequest(`${commentsUrl}/${existing.id}`, {
      method: 'PUT',
      auth,
      body: payload
    });
  }

  return bitbucketRequest(commentsUrl, {
    method: 'POST',
    auth,
    body: payload
  });
}

async function reconcileBlockingTask({ repo, prId, auth, failed, comment }) {
  if (!shouldCreateTask()) {
    return;
  }

  const repoPath = repositoryApiPath(repo);
  if (!repoPath) {
    throw new Error(`Invalid Bitbucket repository slug: ${repo}`);
  }

  const tasksUrl = `https://api.bitbucket.org/2.0/repositories/${repoPath}/pullrequests/${encodeURIComponent(prId)}/tasks`;
  const tasks = await paginatedValues(`${tasksUrl}?pagelen=100`, auth);
  const openTask = tasks.find((task) =>
    task?.state !== 'RESOLVED' && String(task?.content?.raw || '').includes(TASK_MARKER)
  );

  if (!failed) {
    if (openTask?.id) {
      await bitbucketRequest(`${tasksUrl}/${openTask.id}`, {
        method: 'PUT',
        auth,
        body: {
          content: {
            raw: openTask.content.raw
          },
          state: 'RESOLVED'
        }
      });
      console.log(`Resolved Bitbucket Governance task ${openTask.id}.`);
    }
    return;
  }

  if (openTask?.id) {
    console.log(`Bitbucket Governance task ${openTask.id} is already open.`);
    return;
  }

  const taskPayload = {
    content: {
      raw: `Resolve API Governance failures before merge. (${TASK_MARKER})`
    }
  };
  if (comment?.id) {
    taskPayload.comment = {
      id: comment.id
    };
  }

  const created = await bitbucketRequest(tasksUrl, {
    method: 'POST',
    auth,
    body: taskPayload
  });
  console.log(`Created Bitbucket Governance task ${created.id}.`);
}

async function publishToBitbucket({ failed, reportBody }) {
  const repo = repositorySlug();
  const prId = pullRequestId();
  const auth = authHeader();

  if (!repo || !prId) {
    console.log('Skipping Bitbucket PR comment: repository slug or pull request ID is unavailable.');
    return;
  }

  if (!auth) {
    console.log('Skipping Bitbucket PR comment: no Bitbucket API credentials were provided.');
    return;
  }

  const comment = await upsertReportComment({
    repo,
    prId,
    auth,
    body: reportBody
  });
  console.log(`Updated Bitbucket PR #${prId} Governance comment.`);

  await reconcileBlockingTask({
    repo,
    prId,
    auth,
    failed,
    comment
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const lintResult = readJson(args.lintResults);
  const stderr = readText(args.lintStderr);
  const breakingSummary = readText(args.breakingSummary);
  const breakingLog = readText(args.breakingLog);
  const violations = normalizeViolations(lintResult);
  const failed = args.lintExit !== 0 || args.breakingExit !== 0;
  const reportBody = markdownReport({
    lintExit: args.lintExit,
    violations,
    parseError: lintResult.parseError,
    breakingExit: args.breakingExit,
    breakingSummary,
    breakingLog
  });

  consoleSummary({
    lintExit: args.lintExit,
    violations,
    stderr,
    parseError: lintResult.parseError,
    breakingExit: args.breakingExit,
    breakingSummary
  });
  writeFileSync('lint-summary.md', reportBody);

  try {
    await publishToBitbucket({
      failed,
      reportBody
    });
  } catch (error) {
    console.warn(`warning: Failed to update Bitbucket PR Governance report: ${error.message}`);
  }
}

main().catch((error) => {
  console.warn(`warning: Failed to generate Governance report: ${error.message}`);
});
