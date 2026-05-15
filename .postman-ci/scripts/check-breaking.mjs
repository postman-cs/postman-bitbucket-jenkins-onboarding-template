import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { loadConfig, resolveRepoPath, rootDir } from './config.mjs';

const config = loadConfig();
const baselinePath = resolveRepoPath(config.api.baselineSpecPath);
const currentPath = resolveRepoPath(config.api.specPath);
const baselineDir = path.dirname(baselinePath);
const currentDir = path.dirname(currentPath);

if (!config.api.baselineSpecPath || !existsSync(baselinePath)) {
  console.log(`No baseline spec found at ${config.api.baselineSpecPath}; skipping breaking-change check.`);
  process.exit(0);
}

function loadYaml(filePath) {
  return readFile(filePath, 'utf8').then((content) => YAML.parse(content));
}

function normalizeRef(refValue, ownerDir) {
  if (refValue.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(refValue)) {
    return refValue;
  }

  const [filePath, pointer = ''] = refValue.split('#');
  const normalizedPath = path
    .relative(rootDir, path.resolve(ownerDir, filePath))
    .split(path.sep)
    .join('/');

  return pointer ? `${normalizedPath}#${pointer}` : normalizedPath;
}

function compareValues(base, current, context, issues) {
  if (base === undefined) {
    return;
  }

  if (typeof base === 'string' || typeof base === 'number' || typeof base === 'boolean') {
    const normalizedBase =
      typeof base === 'string' && typeof current === 'string' && context.endsWith('.$ref')
        ? normalizeRef(base, baselineDir)
        : base;
    const normalizedCurrent =
      typeof base === 'string' && typeof current === 'string' && context.endsWith('.$ref')
        ? normalizeRef(current, currentDir)
        : current;

    if (normalizedBase !== normalizedCurrent) {
      issues.push(`${context} changed from ${JSON.stringify(base)} to ${JSON.stringify(current)}`);
    }
    return;
  }

  if (Array.isArray(base)) {
    if (!Array.isArray(current)) {
      issues.push(`${context} changed from array to non-array`);
      return;
    }

    const baseIsScalar = base.every((item) => ['string', 'number', 'boolean'].includes(typeof item));
    if (baseIsScalar) {
      const currentSet = new Set(current.map((item) => JSON.stringify(item)));
      for (const item of base) {
        if (!currentSet.has(JSON.stringify(item))) {
          issues.push(`${context} is missing value ${JSON.stringify(item)}`);
        }
      }
      return;
    }

    for (let index = 0; index < base.length; index += 1) {
      compareValues(base[index], current[index], `${context}[${index}]`, issues);
    }
    return;
  }

  if (base && typeof base === 'object') {
    if (!current || typeof current !== 'object') {
      issues.push(`${context} changed from object to non-object`);
      return;
    }

    for (const key of Object.keys(base)) {
      compareValues(base[key], current[key], `${context}.${key}`, issues);
    }
  }
}

function comparePaths(basePaths, currentPaths, issues) {
  for (const pathName of Object.keys(basePaths)) {
    if (!currentPaths?.[pathName]) {
      issues.push(`Path removed: ${pathName}`);
      continue;
    }

    for (const method of Object.keys(basePaths[pathName])) {
      if (!currentPaths[pathName][method]) {
        issues.push(`Operation removed: ${method.toUpperCase()} ${pathName}`);
      }
    }
  }
}

function compareSchemas(baseSchemas, currentSchemas, issues) {
  for (const schemaName of Object.keys(baseSchemas)) {
    if (!currentSchemas?.[schemaName]) {
      issues.push(`Schema removed: ${schemaName}`);
      continue;
    }

    compareValues(
      baseSchemas[schemaName],
      currentSchemas[schemaName],
      `components.schemas.${schemaName}`,
      issues
    );
  }
}

const [baseline, current] = await Promise.all([
  loadYaml(baselinePath),
  loadYaml(currentPath)
]);

const issues = [];
comparePaths(baseline.paths ?? {}, current.paths ?? {}, issues);
compareSchemas(
  baseline.components?.schemas ?? {},
  current.components?.schemas ?? {},
  issues
);

if (issues.length > 0) {
  console.error('Breaking changes detected:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log('No breaking changes detected against baseline.');
