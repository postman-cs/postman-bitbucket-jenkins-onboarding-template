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

const { format } = parseArgs(process.argv.slice(2));
const config = loadConfig();

const values = {
  POSTMAN_CI_PROJECT_NAME: config.project.name,
  POSTMAN_CI_DOMAIN: config.project.domain,
  POSTMAN_CI_DOMAIN_CODE: config.project.domainCode,
  POSTMAN_CI_REQUESTER_EMAIL: config.project.requesterEmail,
  POSTMAN_CI_SOURCE_SPEC_PATH: config.api.specPath,
  POSTMAN_CI_BUNDLED_SPEC_PATH: config.api.bundledSpecPath,
  POSTMAN_CI_BASELINE_SPEC_PATH: config.api.baselineSpecPath,
  POSTMAN_CI_COMMON_SCHEMA_PATHS_JSON: JSON.stringify(config.api.commonSchemaPaths),
  POSTMAN_CI_CONTRACT_CHANGE_PATHS_JSON: JSON.stringify(config.api.contractChangePaths),
  POSTMAN_CI_RESOURCES_PATH: config.postman.resourcesPath,
  POSTMAN_CI_SMOKE_FLOW_PATH: config.postman.smokeFlowPath,
  POSTMAN_CI_APP_INSTALL_COMMAND: config.ci.installCommand,
  POSTMAN_CI_APP_BUILD_COMMAND: config.ci.buildCommand,
  POSTMAN_CI_LOCAL_START_COMMAND: config.ci.startCommand,
  POSTMAN_CI_LOCAL_BASE_URL: config.ci.localBaseUrl,
  POSTMAN_CI_LOCAL_HEALTH_URL: config.ci.localHealthUrl,
  POSTMAN_CI_LOCAL_READY_TIMEOUT_SECONDS: String(config.ci.localReadyTimeoutSeconds),
  POSTMAN_CI_RUN_LOCAL_CONTRACT: String(config.ci.runLocalContract),
  POSTMAN_CI_RUN_STAGE_SMOKE: String(config.ci.runStageSmoke)
};

for (const [name, value] of Object.entries(values)) {
  if (format === 'ps1') {
    console.log(`$env:${name}=${powerShellQuote(value)}`);
  } else {
    console.log(`${name}=${shellQuote(value)}`);
  }
}
