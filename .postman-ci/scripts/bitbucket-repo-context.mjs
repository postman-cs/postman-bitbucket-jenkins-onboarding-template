import { execFileSync } from 'node:child_process';
import { powerShellQuote, shellQuote } from './config.mjs';

function parseArgs(argv) {
  let format = 'sh';

  for (const arg of argv) {
    if (arg.startsWith('--format=')) {
      format = arg.slice('--format='.length).trim();
    }
  }

  if (!['sh', 'ps1'].includes(format)) {
    throw new Error(`Unsupported output format: ${format}`);
  }

  return { format };
}

function gitRemoteUrl() {
  return execFileSync('git', ['remote', 'get-url', 'origin'], {
    encoding: 'utf8'
  }).trim();
}

function firstValue(...values) {
  return values.find((value) => String(value ?? '').trim()) ?? '';
}

function parseRemoteUrl(rawUrl) {
  const raw = String(rawUrl ?? '').trim();

  const sshMatch = raw.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const [, host, repoPath] = sshMatch;
    return {
      host,
      repoPath: repoPath.replace(/^\/+|\.git$/g, '')
    };
  }

  const parsedUrl = new URL(raw);
  return {
    host: parsedUrl.host,
    repoPath: parsedUrl.pathname.replace(/^\/+|\.git$/g, '')
  };
}

const explicitSlug = firstValue(
  process.env.BITBUCKET_REPOSITORY_SLUG,
  process.env.BITBUCKET_REPO_FULL_NAME,
  process.env.BITBUCKET_WORKSPACE && process.env.BITBUCKET_REPO_SLUG
    ? `${process.env.BITBUCKET_WORKSPACE}/${process.env.BITBUCKET_REPO_SLUG}`
    : ''
);
const rawRemoteUrl = firstValue(
  process.env.BITBUCKET_GIT_HTTP_ORIGIN,
  process.env.GIT_URL,
  gitRemoteUrl()
);
const parsed = parseRemoteUrl(rawRemoteUrl);
const repositorySlug = explicitSlug || parsed.repoPath;
const httpsRemoteUrl = `https://${parsed.host}/${parsed.repoPath}.git`;
const { format } = parseArgs(process.argv.slice(2));

if (!repositorySlug) {
  throw new Error('Unable to resolve Bitbucket repository slug.');
}

if (format === 'ps1') {
  console.log(`$env:BITBUCKET_REPOSITORY_SLUG=${powerShellQuote(repositorySlug)}`);
  console.log(`$env:BITBUCKET_HTTPS_REMOTE_URL=${powerShellQuote(httpsRemoteUrl)}`);
} else {
  console.log(`BITBUCKET_REPOSITORY_SLUG=${shellQuote(repositorySlug)}`);
  console.log(`BITBUCKET_HTTPS_REMOTE_URL=${shellQuote(httpsRemoteUrl)}`);
}
