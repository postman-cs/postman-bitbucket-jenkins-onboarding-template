#!/usr/bin/env node

const path = require('node:path');

const cliPath = path.resolve(
  process.cwd(),
  '.postman-ci/vendor/postman-bootstrap-cli.cjs'
);

const originalEntrypoint = process.argv[1];
process.argv[1] = __filename;

let runCli;
try {
  ({ runCli } = require(cliPath));
} finally {
  process.argv[1] = originalEntrypoint;
}

runCli(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
