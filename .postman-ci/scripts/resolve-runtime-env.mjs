import { loadConfig, powerShellQuote, shellQuote } from './config.mjs';

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

function parseJsonObject(name) {
  const defaults = {
    POSTMAN_RUNTIME_URLS_JSON: '{"TEST":"http://localhost:3000","STAGE":"https://stage.example.com","PROD":"https://api.example.com"}',
    POSTMAN_GOVERNANCE_GROUPS_JSON: '{"sample-domain":"api-governance-group"}'
  };
  const rawValue = String(process.env[name] ?? defaults[name] ?? '').trim();
  if (!rawValue) {
    throw new Error(`${name} is required and must be a JSON object.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object.`);
  }

  return Object.fromEntries(
    Object.entries(parsed)
      .map(([key, value]) => [String(key).trim(), String(value ?? '').trim()])
      .filter(([key, value]) => key && value)
  );
}

function parseOptionalJsonObject(name) {
  const rawValue = String(process.env[name] ?? '').trim();
  if (!rawValue) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object.`);
  }

  return Object.fromEntries(
    Object.entries(parsed)
      .map(([key, value]) => [String(key).trim(), String(value ?? '').trim()])
      .filter(([key, value]) => key && value)
  );
}

function findKeyCaseInsensitive(values, requestedKey) {
  const exactKey = Object.keys(values).find((key) => key === requestedKey);
  if (exactKey) {
    return exactKey;
  }

  return Object.keys(values).find(
    (key) => key.toLowerCase() === requestedKey.toLowerCase()
  );
}

function canonicalLookupKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function systemEnvironmentAliases(envName) {
  const aliases = new Map([
    ['dev', ['dev', 'development']],
    ['test', ['test', 'testing', 'qa', 'qualityassurance']],
    ['stage', ['stage', 'staging', 'preprod', 'preproduction']],
    ['uat', ['uat', 'useracceptance']],
    ['prod', ['prod', 'production', 'live']]
  ]);

  const canonical = canonicalLookupKey(envName);
  const matchedAliases = aliases.get(canonical) ?? [];
  return [envName, canonical, ...matchedAliases];
}

function resolveSystemEnvironmentMap(runtimeUrls, systemEnvMap) {
  const resolved = {};
  const entries = Object.entries(systemEnvMap);
  const byCanonicalKey = new Map(
    entries.map(([key, value]) => [canonicalLookupKey(key), value])
  );

  for (const envName of Object.keys(runtimeUrls)) {
    if (Object.hasOwn(systemEnvMap, envName)) {
      resolved[envName] = systemEnvMap[envName];
      continue;
    }

    const caseInsensitiveKey = findKeyCaseInsensitive(systemEnvMap, envName);
    if (caseInsensitiveKey) {
      resolved[envName] = systemEnvMap[caseInsensitiveKey];
      continue;
    }

    for (const alias of systemEnvironmentAliases(envName)) {
      const value = byCanonicalKey.get(canonicalLookupKey(alias));
      if (value) {
        resolved[envName] = value;
        break;
      }
    }
  }

  return resolved;
}

function requireRuntimeEnvironment(runtimeUrls, requestedName, label) {
  const normalizedName = String(requestedName ?? '').trim();
  if (!normalizedName) {
    throw new Error(`${label} environment name is required.`);
  }

  const matchedName = findKeyCaseInsensitive(runtimeUrls, normalizedName);
  if (!matchedName) {
    throw new Error(
      `${label} environment "${normalizedName}" is not present in POSTMAN_RUNTIME_URLS_JSON.`
    );
  }

  return matchedName;
}

function validateEnvironmentName(name) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `Environment name "${name}" is not supported. Use letters, numbers, and underscores only.`
    );
  }
}

const config = loadConfig();
const { format } = parseArgs(process.argv.slice(2));

const runtimeUrls = parseJsonObject('POSTMAN_RUNTIME_URLS_JSON');
for (const envName of Object.keys(runtimeUrls)) {
  validateEnvironmentName(envName);
}
const systemEnvMap = resolveSystemEnvironmentMap(
  runtimeUrls,
  parseOptionalJsonObject('POSTMAN_SYSTEM_ENV_MAP_JSON')
);
const governanceGroups = parseJsonObject('POSTMAN_GOVERNANCE_GROUPS_JSON');
const domain = String(config.project.domain ?? '').trim();
const governanceDomain = findKeyCaseInsensitive(governanceGroups, domain);

if (!governanceDomain) {
  throw new Error(
    `No governance group mapping found for project.domain "${domain}" in POSTMAN_GOVERNANCE_GROUPS_JSON.`
  );
}

const contractEnvironment = requireRuntimeEnvironment(
  runtimeUrls,
  process.env.POSTMAN_CONTRACT_ENVIRONMENT || 'TEST',
  'Contract'
);
const smokeEnvironment = requireRuntimeEnvironment(
  runtimeUrls,
  process.env.POSTMAN_SMOKE_ENVIRONMENT || 'STAGE',
  'Smoke'
);

const outputValues = {
  POSTMAN_CI_GOVERNANCE_GROUP: governanceGroups[governanceDomain],
  POSTMAN_CI_ENVIRONMENTS_JSON: JSON.stringify(Object.keys(runtimeUrls)),
  POSTMAN_CI_RUNTIME_URLS_JSON: JSON.stringify(runtimeUrls),
  POSTMAN_CI_SYSTEM_ENV_MAP_JSON: JSON.stringify(systemEnvMap),
  POSTMAN_CI_CONTRACT_ENVIRONMENT_NAME: contractEnvironment,
  POSTMAN_CI_SMOKE_ENVIRONMENT_NAME: smokeEnvironment
};

for (const [name, value] of Object.entries(outputValues)) {
  if (format === 'ps1') {
    console.log(`$env:${name}=${powerShellQuote(value)}`);
  } else {
    console.log(`${name}=${shellQuote(value)}`);
  }
}
