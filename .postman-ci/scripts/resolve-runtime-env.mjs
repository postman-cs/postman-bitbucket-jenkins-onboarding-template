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

function findKeyCaseInsensitive(values, requestedKey) {
  const exactKey = Object.keys(values).find((key) => key === requestedKey);
  if (exactKey) {
    return exactKey;
  }

  return Object.keys(values).find(
    (key) => key.toLowerCase() === requestedKey.toLowerCase()
  );
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
