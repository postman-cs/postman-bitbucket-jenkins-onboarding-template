import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, chmodSync, copyFileSync } from 'node:fs';
import { get } from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = process.env.OPENAPI_CHANGES_VERSION || '0.2.7';
const TOOL_NAME = 'openapi-changes';
const RELEASE_BASE_URL = `https://github.com/pb33f/openapi-changes/releases/download/v${VERSION}`;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '../..');
const toolRoot = path.join(rootDir, '.jenkins-tools', TOOL_NAME);
const binDir = path.join(toolRoot, 'bin');
const downloadsDir = path.join(toolRoot, 'downloads');
const extractDir = path.join(toolRoot, `extract-${Date.now()}`);
const binaryName = process.platform === 'win32' ? `${TOOL_NAME}.exe` : TOOL_NAME;
const binaryPath = path.join(binDir, binaryName);

const CHECKSUMS = {
  '0.2.7': {
    'openapi-changes_0.2.7_darwin_arm64.tar.gz': '03e65e0d16c51fb8d43a93318409027bd9cd7c7c3355061d23c084c1ac9c0f7b',
    'openapi-changes_0.2.7_darwin_x86_64.tar.gz': 'c064dab16fac342926126d060efd157ff283e18548ccf6081a7a71a8d3c5bc04',
    'openapi-changes_0.2.7_linux_arm64.tar.gz': '698b29336699fd4ec61e52585f140a6450d112c1eb1c637bbe34c13b4203fecc',
    'openapi-changes_0.2.7_linux_i386.tar.gz': 'bb95699989ef67d0fd9d8644e56b1e183dea4dc439e59d051fe6964b87636f8c',
    'openapi-changes_0.2.7_linux_x86_64.tar.gz': '333742ea369c90437fbda47a814cf2393cb65eaa3867268a4c86281e74f614bf',
    'openapi-changes_0.2.7_windows_arm64.tar.gz': '3dfc29f88fb4332a3bf2d6d45fb8e8630ad943c4b9d814',
    'openapi-changes_0.2.7_windows_i386.tar.gz': '78e868e15d0e15f358f7f350af3c9532f6720a140bbb9241dbb947d49c6ec20c',
    'openapi-changes_0.2.7_windows_x86_64.tar.gz': 'fff5a68713b9093ad8ab547d214b5a3b9139ad71e90ee9e1347b3f9bd6e1e191'
  }
};

function mapPlatform() {
  const platforms = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'windows'
  };
  const platform = platforms[process.platform];
  if (!platform) {
    throw new Error(`Unsupported openapi-changes platform: ${process.platform}`);
  }
  return platform;
}

function mapArch() {
  const architectures = {
    arm64: 'arm64',
    ia32: 'i386',
    x64: 'x86_64'
  };
  const arch = architectures[process.arch];
  if (!arch) {
    throw new Error(`Unsupported openapi-changes architecture: ${process.arch}`);
  }
  return arch;
}

function assertBinaryWorks() {
  const installedVersion = execFileSync(binaryPath, ['version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
  if (installedVersion !== VERSION) {
    throw new Error(`Expected ${TOOL_NAME} ${VERSION}, found ${installedVersion || '(unknown)'}.`);
  }
}

function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function download(url, destination, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;

      if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
        response.resume();
        if (redirectsRemaining <= 0) {
          reject(new Error(`Too many redirects while downloading ${url}`));
          return;
        }
        const redirectedUrl = new URL(location, url);
        if (redirectedUrl.protocol !== 'https:') {
          reject(new Error(`Refusing non-HTTPS redirect for ${url}`));
          return;
        }
        download(redirectedUrl.toString(), destination, redirectsRemaining - 1).then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Download failed for ${url}: HTTP ${statusCode}`));
        return;
      }

      const output = createWriteStream(destination, { flags: 'w' });
      response.pipe(output);
      output.on('finish', () => {
        output.close(resolve);
      });
      output.on('error', reject);
    }).on('error', reject);
  });
}

function assertSafeTarEntries(archivePath) {
  const listing = execFileSync('tar', ['-tzf', archivePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (const rawEntry of listing.split(/\r?\n/)) {
    const entry = rawEntry.trim();
    if (!entry) {
      continue;
    }
    if (entry.startsWith('/') || entry.startsWith('\\') || entry.includes('..')) {
      throw new Error(`Refusing unsafe archive entry: ${entry}`);
    }
  }
}

function findBinary(searchRoot) {
  const entries = readdirSync(searchRoot, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(searchRoot, entry.name);
    if (entry.isDirectory()) {
      const nested = findBinary(entryPath);
      if (nested) {
        return nested;
      }
    } else if (entry.name === binaryName || entry.name === TOOL_NAME) {
      return entryPath;
    }
  }
  return '';
}

async function main() {
  if (existsSync(binaryPath)) {
    try {
      assertBinaryWorks();
      console.log(`${TOOL_NAME} ${VERSION} already installed at ${binaryPath}`);
      return;
    } catch (error) {
      console.warn(`warning: Reinstalling ${TOOL_NAME}: ${error.message}`);
      rmSync(binaryPath, { force: true });
    }
  }

  const platform = mapPlatform();
  const arch = mapArch();
  const assetName = `${TOOL_NAME}_${VERSION}_${platform}_${arch}.tar.gz`;
  const expectedChecksum = CHECKSUMS[VERSION]?.[assetName];
  if (!expectedChecksum) {
    throw new Error(`No pinned checksum is configured for ${assetName}.`);
  }

  mkdirSync(binDir, { recursive: true });
  mkdirSync(downloadsDir, { recursive: true });
  mkdirSync(extractDir, { recursive: true });

  const archivePath = path.join(downloadsDir, assetName);
  await download(`${RELEASE_BASE_URL}/${assetName}`, archivePath);

  const actualChecksum = sha256(archivePath);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`Checksum mismatch for ${assetName}: expected ${expectedChecksum}, got ${actualChecksum}`);
  }

  assertSafeTarEntries(archivePath);
  execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const extractedBinary = findBinary(extractDir);
  if (!extractedBinary) {
    throw new Error(`Could not find ${binaryName} in ${assetName}.`);
  }

  rmSync(binaryPath, { force: true });
  copyFileSync(extractedBinary, binaryPath);
  if (process.platform !== 'win32') {
    chmodSync(binaryPath, 0o755);
  }
  rmSync(extractDir, { recursive: true, force: true });

  assertBinaryWorks();
  console.log(`Installed ${TOOL_NAME} ${VERSION} at ${binaryPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
