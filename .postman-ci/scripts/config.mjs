import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const rootDir = process.cwd();

const defaultConfig = {
  project: {
    name: 'sample-api',
    domain: 'sample-domain',
    domainCode: 'API',
    requesterEmail: 'api-owner@example.com'
  },
  api: {
    specPath: 'api/openapi.yaml',
    bundledSpecPath: 'api/openapi.bundled.yaml',
    baselineSpecPath: '',
    commonSchemaPaths: [],
    contractChangePaths: []
  },
  postman: {
    resourcesPath: '.postman/resources.yaml',
    smokeFlowPath: ''
  },
  ci: {
    installCommand: '',
    buildCommand: '',
    startCommand: '',
    localBaseUrl: 'http://localhost:3000',
    healthPath: '/health',
    localReadyTimeoutSeconds: 60,
    runLocalContract: true,
    runStageSmoke: false
  }
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeConfig(base, override) {
  if (!isPlainObject(override)) {
    return structuredClone(base);
  }

  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = mergeConfig(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return [String(value).trim()].filter(Boolean);
}

function asBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function normalizePath(value) {
  return String(value ?? '').trim().replace(/\\/g, '/');
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:\//.test(value);
}

function isInsideRoot(resolvedPath) {
  const relativePath = path.relative(rootDir, resolvedPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function normalizeRepoPath(value, { label = 'path', allowEmpty = false } = {}) {
  const normalized = normalizePath(value);
  if (!normalized) {
    if (allowEmpty) {
      return '';
    }
    throw new Error(`${label} is required.`);
  }
  if (path.isAbsolute(normalized) || isWindowsAbsolutePath(normalized)) {
    throw new Error(`${label} must be relative to the repository root.`);
  }

  const resolvedPath = path.resolve(rootDir, normalized);
  if (!isInsideRoot(resolvedPath)) {
    throw new Error(`${label} must stay within the repository root.`);
  }

  return normalized;
}

function normalizeRepoPaths(values, label) {
  return asArray(values).map((entry, index) =>
    normalizeRepoPath(entry, { label: `${label}[${index}]` })
  );
}

export function configPath() {
  return normalizeRepoPath(process.env.POSTMAN_CI_CONFIG_PATH || '.postman-ci/config.yaml', {
    label: 'POSTMAN_CI_CONFIG_PATH'
  });
}

export function loadConfig() {
  const filePath = resolveRepoPath(configPath(), 'POSTMAN_CI_CONFIG_PATH');
  const rawConfig = existsSync(filePath)
    ? YAML.parse(readFileSync(filePath, 'utf8')) ?? {}
    : {};
  const config = mergeConfig(defaultConfig, rawConfig);

  config.api.specPath = normalizeRepoPath(config.api.specPath ?? config.api.source, {
    label: 'api.specPath'
  });
  config.api.bundledSpecPath = normalizeRepoPath(config.api.bundledSpecPath ?? config.api.bundled, {
    label: 'api.bundledSpecPath'
  });
  config.api.baselineSpecPath = normalizeRepoPath(config.api.baselineSpecPath ?? config.api.baseline, {
    label: 'api.baselineSpecPath',
    allowEmpty: true
  });
  config.api.commonSchemaPaths = normalizeRepoPaths(
    config.api.commonSchemaPaths ?? config.api.commonSchemas,
    'api.commonSchemaPaths'
  );
  config.api.contractChangePaths = normalizeRepoPaths(
    config.api.contractChangePaths,
    'api.contractChangePaths'
  );
  if (config.api.contractChangePaths.length === 0) {
    config.api.contractChangePaths = [
      config.api.specPath,
      ...config.api.commonSchemaPaths
    ].filter(Boolean);
  }

  config.postman.resourcesPath = normalizeRepoPath(config.postman.resourcesPath, {
    label: 'postman.resourcesPath'
  });
  config.postman.smokeFlowPath = normalizeRepoPath(config.postman.smokeFlowPath, {
    label: 'postman.smokeFlowPath',
    allowEmpty: true
  });

  config.ci.installCommand = String(config.ci.installCommand ?? config.ci.appInstallCommand ?? '').trim();
  config.ci.buildCommand = String(config.ci.buildCommand ?? config.ci.appBuildCommand ?? '').trim();
  config.ci.startCommand = String(config.ci.startCommand ?? config.ci.localStartCommand ?? '').trim();
  config.ci.localBaseUrl = String(config.ci.localBaseUrl ?? 'http://localhost:3000').trim();
  config.ci.healthPath = String(config.ci.healthPath ?? '').trim();
  config.ci.localHealthUrl = String(config.ci.localHealthUrl ?? '').trim();
  if (!config.ci.localHealthUrl && config.ci.healthPath) {
    config.ci.localHealthUrl = new URL(config.ci.healthPath, config.ci.localBaseUrl).toString();
  }
  config.ci.runLocalContract = asBoolean(config.ci.runLocalContract, true);
  config.ci.runStageSmoke = asBoolean(config.ci.runStageSmoke, false);
  config.ci.localReadyTimeoutSeconds = Number(config.ci.localReadyTimeoutSeconds || 60);

  config.api.source = config.api.specPath;
  config.api.bundled = config.api.bundledSpecPath;
  config.api.baseline = config.api.baselineSpecPath;
  config.api.commonSchemas = config.api.commonSchemaPaths;
  config.ci.appInstallCommand = config.ci.installCommand;
  config.ci.appBuildCommand = config.ci.buildCommand;
  config.ci.localStartCommand = config.ci.startCommand;

  return config;
}

export function resolveRepoPath(repoRelativePath, label = 'path') {
  return path.resolve(rootDir, normalizeRepoPath(repoRelativePath, { label }));
}

export function toPosixPath(filePath) {
  return String(filePath ?? '').replace(/\\/g, '/');
}

export function relativeToRoot(filePath) {
  return toPosixPath(path.relative(rootDir, filePath));
}

export function shellQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

export function powerShellQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `''`)}'`;
}
