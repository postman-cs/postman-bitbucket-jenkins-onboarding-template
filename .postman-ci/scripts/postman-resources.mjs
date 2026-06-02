import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { loadConfig, resolveRepoPath } from './config.mjs';

export const UPDATE_READY_REQUIRED_KEYS = ['workspace', 'spec', 'baseline', 'smoke', 'contract'];
const STATIC_RESOURCE_KEYS = new Set([...UPDATE_READY_REQUIRED_KEYS, 'mock', 'monitor']);

function findValueByPathFragment(values, fragment) {
  const normalizedFragment = String(fragment).toLowerCase();
  return Object.entries(values).find(([filePath]) => {
    return String(filePath).toLowerCase().includes(normalizedFragment);
  })?.[1] ?? '';
}

function parseEnvironmentNames(env) {
  const rawValue = String(env.POSTMAN_CI_ENVIRONMENTS_JSON ?? '').trim();
  if (!rawValue) {
    return [];
  }

  const parsed = JSON.parse(rawValue);
  if (!Array.isArray(parsed)) {
    throw new Error('POSTMAN_CI_ENVIRONMENTS_JSON must be a JSON array.');
  }

  return parsed.map((entry) => String(entry).trim()).filter(Boolean);
}

function environmentNamesFromKeys(keys) {
  return keys
    .map((key) => String(key).trim().toLowerCase())
    .filter((key) => key && !STATIC_RESOURCE_KEYS.has(key))
    .map((key) => key.toUpperCase());
}

function uniqueEnvironmentNames(names) {
  const seen = new Set();
  const result = [];

  for (const name of names) {
    const normalizedName = String(name).trim().toUpperCase();
    const lookupKey = normalizedName.toLowerCase();
    if (!normalizedName || seen.has(lookupKey)) {
      continue;
    }
    seen.add(lookupKey);
    result.push(normalizedName);
  }

  return result;
}

export function missingResourceKeys(values, requiredKeys) {
  return requiredKeys.filter((key) => !values[key]);
}

function resourceKeys(values) {
  return Object.keys(values ?? {});
}

export async function resolvePostmanResourceValues({
  env = process.env,
  environmentKeys = [],
  includeEnvironmentValues = true,
  warn = () => {}
} = {}) {
  const config = loadConfig();
  const resourcesPath = resolveRepoPath(config.postman.resourcesPath);
  const resourcesExist = existsSync(resourcesPath);
  let resources = {};

  if (resourcesExist) {
    try {
      resources = YAML.parse(await readFile(resourcesPath, 'utf8')) ?? {};
    } catch (error) {
      warn(
        `Unable to read Postman resources from ${config.postman.resourcesPath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      resources = {};
    }
  }

  const cloudResources = resources.cloudResources ?? {};
  const collections = cloudResources.collections ?? {};
  const environments = cloudResources.environments ?? {};
  const specs = cloudResources.specs ?? {};
  const environmentNames = includeEnvironmentValues
    ? uniqueEnvironmentNames([...parseEnvironmentNames(env), ...environmentNamesFromKeys(environmentKeys)])
    : [];

  const values = {
    workspace: String(resources.workspace?.id ?? ''),
    spec: String(
      specs[`../${config.api.specPath}`] ??
      specs[`../${config.api.bundledSpecPath}`] ??
      Object.values(specs)[0] ??
      ''
    ),
    baseline: String(findValueByPathFragment(collections, '[Baseline]')),
    smoke: String(findValueByPathFragment(collections, '[Smoke]')),
    contract: String(findValueByPathFragment(collections, '[Contract]')),
    mock: String(cloudResources.mocks?.default ?? cloudResources.mockUrl ?? ''),
    monitor: String(cloudResources.monitors?.smoke ?? cloudResources.monitorId ?? '')
  };

  for (const envName of environmentNames) {
    values[envName.toLowerCase()] = String(
      findValueByPathFragment(environments, `${envName}.postman_environment.json`)
    );
  }

  return {
    resourcesPath,
    resourcesDisplayPath: config.postman.resourcesPath,
    resourcesExist,
    environmentNames,
    availableResources: {
      specs: resourceKeys(specs),
      collections: resourceKeys(collections),
      environments: resourceKeys(environments)
    },
    values
  };
}
