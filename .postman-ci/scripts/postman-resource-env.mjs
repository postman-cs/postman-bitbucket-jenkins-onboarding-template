import { powerShellQuote, shellQuote } from './config.mjs';
import {
  missingResourceKeys,
  resolvePostmanResourceValues
} from './postman-resources.mjs';

function parseArgs(argv) {
  const required = new Set();
  let format = 'sh';

  for (const arg of argv) {
    if (arg.startsWith('--format=')) {
      format = arg.slice('--format='.length).trim();
      continue;
    }

    if (!arg.startsWith('--require=')) {
      continue;
    }

    for (const key of arg.slice('--require='.length).split(',')) {
      const normalizedKey = key.trim().toLowerCase();
      if (normalizedKey) {
        required.add(normalizedKey);
      }
    }
  }

  if (!['sh', 'ps1'].includes(format)) {
    throw new Error(`Unsupported output format: ${format}`);
  }

  return { required, format };
}

function formatList(values) {
  return values.length > 0 ? values.join(', ') : '(none)';
}

function writeResourceDiagnostics({
  availableResources,
  missing,
  required,
  resourcesDisplayPath,
  resourcesExist
}) {
  console.error('Postman resource diagnostics');
  console.error(`resources path: ${resourcesDisplayPath}`);
  console.error(`resources file exists: ${resourcesExist}`);
  console.error(`required values: ${formatList(required)}`);
  console.error(`missing values: ${formatList(missing)}`);
  console.error(`available specs: ${formatList(availableResources.specs)}`);
  console.error(`available collections: ${formatList(availableResources.collections)}`);
  console.error(`available environments: ${formatList(availableResources.environments)}`);
}

const { required, format } = parseArgs(process.argv.slice(2));
const {
  availableResources,
  environmentNames,
  resourcesDisplayPath,
  resourcesExist,
  values
} = await resolvePostmanResourceValues({
  env: process.env,
  environmentKeys: [...required],
  warn: (message) => console.error(message)
});

const missing = missingResourceKeys(values, [...required]);
if (missing.length > 0) {
  writeResourceDiagnostics({
    availableResources,
    missing,
    required: [...required],
    resourcesDisplayPath,
    resourcesExist
  });
  throw new Error(`Missing required Postman resource values: ${missing.join(', ')}`);
}

const envNames = {
  workspace: 'POSTMAN_WORKSPACE_ID',
  spec: 'POSTMAN_SPEC_ID',
  baseline: 'POSTMAN_BASELINE_COLLECTION_ID',
  smoke: 'POSTMAN_SMOKE_COLLECTION_ID',
  contract: 'POSTMAN_CONTRACT_COLLECTION_ID',
  mock: 'POSTMAN_MOCK_URL',
  monitor: 'POSTMAN_MONITOR_ID'
};

for (const envName of environmentNames) {
  envNames[envName.toLowerCase()] = `POSTMAN_${envName.toUpperCase()}_ENVIRONMENT_ID`;
}

for (const [key, envName] of Object.entries(envNames)) {
  if (format === 'ps1') {
    console.log(`$env:${envName}=${powerShellQuote(values[key])}`);
  } else {
    console.log(`${envName}=${shellQuote(values[key])}`);
  }
}
