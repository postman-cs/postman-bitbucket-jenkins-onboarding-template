import SwaggerParser from '@apidevtools/swagger-parser';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig, resolveRepoPath } from './config.mjs';

const config = loadConfig();
const sourcePath = resolveRepoPath(config.api.specPath);
const bundledPath = resolveRepoPath(config.api.bundledSpecPath);

await access(sourcePath);
await SwaggerParser.validate(sourcePath);
console.log(`Validated source spec: ${config.api.specPath}`);

await import(pathToFileURL(resolveRepoPath('.postman-ci/scripts/bundle-spec.mjs')).href);
await SwaggerParser.validate(bundledPath);
console.log(`Validated bundled spec: ${config.api.bundledSpecPath}`);
