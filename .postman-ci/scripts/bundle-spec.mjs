import SwaggerParser from '@apidevtools/swagger-parser';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { loadConfig, relativeToRoot, resolveRepoPath } from './config.mjs';

const config = loadConfig();
const sourcePath = resolveRepoPath(config.api.specPath);
const bundledPath = resolveRepoPath(config.api.bundledSpecPath);

if (sourcePath === bundledPath) {
  throw new Error('api.specPath and api.bundledSpecPath must be different paths.');
}

const bundledSpec = await SwaggerParser.bundle(sourcePath);

await mkdir(path.dirname(bundledPath), { recursive: true });
await writeFile(bundledPath, YAML.stringify(bundledSpec), 'utf8');

console.log(`Bundled spec written to ${relativeToRoot(bundledPath)}`);
