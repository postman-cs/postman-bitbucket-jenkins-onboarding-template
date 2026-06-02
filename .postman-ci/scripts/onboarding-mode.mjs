import {
  missingResourceKeys,
  resolvePostmanResourceValues,
  UPDATE_READY_REQUIRED_KEYS
} from './postman-resources.mjs';

const requestedMode = String(process.argv[2] || process.env.POSTMAN_ONBOARDING_MODE || 'auto')
  .trim()
  .toLowerCase();

if (!['auto', 'bootstrap', 'update'].includes(requestedMode)) {
  throw new Error(`Unsupported onboarding mode: ${requestedMode}`);
}

if (requestedMode !== 'auto') {
  console.log(requestedMode);
  process.exit(0);
}

const { resourcesExist, values } = await resolvePostmanResourceValues({
  includeEnvironmentValues: false,
  warn: (message) => console.error(message)
});

if (!resourcesExist) {
  console.log('bootstrap');
  process.exit(0);
}

const missing = missingResourceKeys(values, UPDATE_READY_REQUIRED_KEYS);
if (missing.length > 0) {
  console.error(
    `Postman resources are incomplete for update; auto mode will run bootstrap. Missing required Postman resource values: ${missing.join(', ')}`
  );
  console.log('bootstrap');
  process.exit(0);
}

console.log('update');
