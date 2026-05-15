import { loadConfig } from './config.mjs';

const key = process.argv[2];
const config = loadConfig();

const values = {
  sourceSpecPath: config.api.specPath,
  bundledSpecPath: config.api.bundledSpecPath,
  baselineSpecPath: config.api.baselineSpecPath,
  resourcesPath: config.postman.resourcesPath,
  smokeFlowPath: config.postman.smokeFlowPath,
  runLocalContract: String(config.ci.runLocalContract),
  runStageSmoke: String(config.ci.runStageSmoke),
  localStartCommand: config.ci.startCommand
};

if (!Object.hasOwn(values, key)) {
  throw new Error(`Unknown config value: ${key}`);
}

console.log(values[key]);
