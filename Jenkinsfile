def runCiScript(String unixScript, String windowsScript) {
  if (isUnix()) {
    sh(script: unixScript)
  } else {
    powershell(script: windowsScript)
  }
}

def captureCiScript(String unixScript, String windowsScript) {
  if (isUnix()) {
    return sh(script: unixScript, returnStdout: true).trim()
  }

  return powershell(script: windowsScript, returnStdout: true).trim()
}

def isPullRequestBuild() {
  return (env.CHANGE_ID ?: env.BITBUCKET_PULL_REQUEST_ID ?: '').trim() != ''
}

def targetBranchName() {
  def branchName = (env.CHANGE_TARGET ?: env.BITBUCKET_TARGET_BRANCH ?: 'main').trim()
  if (branchName.startsWith('origin/')) {
    branchName = branchName.substring('origin/'.length())
  }
  if (branchName.startsWith('refs/heads/')) {
    branchName = branchName.substring('refs/heads/'.length())
  }
  if (!(branchName ==~ /^[A-Za-z0-9._\/-]+$/)) {
    error("Unsupported target branch name: ${branchName}")
  }

  return branchName
}

def isTrustedPullRequestBuild() {
  if (!isPullRequestBuild()) {
    return false
  }

  def forkName = (
    env.CHANGE_FORK ?:
    env.BITBUCKET_PULL_REQUEST_SOURCE_REPOSITORY_FULL_NAME ?:
    env.BITBUCKET_PULL_REQUEST_SOURCE_REPOSITORY_UUID ?:
    ''
  ).trim()

  return forkName == ''
}

def checkoutTrustedPostmanCiForPullRequest() {
  if (!isPullRequestBuild()) {
    return
  }

  def branchName = targetBranchName()
  echo "Refreshing .postman-ci from trusted target branch origin/${branchName}."
  runCiScript(
    """#!/usr/bin/env bash
set -euo pipefail

git rev-parse --verify "origin/${branchName}^{commit}" >/dev/null
git checkout "origin/${branchName}" -- .postman-ci
""",
    """
\$ErrorActionPreference = 'Stop'

git rev-parse --verify "origin/${branchName}^{commit}" | Out-Null
if (\$LASTEXITCODE -ne 0) { exit \$LASTEXITCODE }
git checkout "origin/${branchName}" -- .postman-ci
if (\$LASTEXITCODE -ne 0) { exit \$LASTEXITCODE }
"""
  )
}

def isMainBranchBuild() {
  def branchName = (env.BRANCH_NAME ?: env.BITBUCKET_BRANCH ?: env.GIT_BRANCH ?: '').trim()
  if (branchName.startsWith('origin/')) {
    branchName = branchName.substring('origin/'.length())
  }
  if (branchName.startsWith('refs/heads/')) {
    branchName = branchName.substring('refs/heads/'.length())
  }

  return branchName == 'main'
}

def isGeneratedArtifactOnlyBuild() {
  if (isPullRequestBuild() || !isMainBranchBuild()) {
    return false
  }

  def cached = (env.POSTMAN_CI_GENERATED_ARTIFACT_ONLY_BUILD ?: '').trim()
  if (cached) {
    return cached == 'true'
  }

  def detected = captureCiScript(
    'node .postman-ci/scripts/is-generated-artifact-commit.mjs',
    'node .postman-ci/scripts/is-generated-artifact-commit.mjs'
  ) == 'true'
  env.POSTMAN_CI_GENERATED_ARTIFACT_ONLY_BUILD = detected ? 'true' : 'false'

  return detected
}

def shouldRunMainOnboardingBuild() {
  return !isPullRequestBuild() && isMainBranchBuild() && !isGeneratedArtifactOnlyBuild()
}

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  parameters {
    choice(name: 'POSTMAN_ONBOARDING_MODE', choices: ['auto', 'bootstrap', 'update'], description: 'auto bootstraps when .postman/resources.yaml is missing and updates when it exists.')
    choice(name: 'POSTMAN_REPO_WRITE_MODE', choices: ['commit-and-push', 'none', 'commit-only'], description: 'How repo-sync handles generated Postman artifacts. commit-and-push uses Jenkins Bitbucket credentials.')
    string(name: 'POSTMAN_PUSH_BRANCH', defaultValue: '', description: 'Optional branch override for generated Postman artifact pushes. Defaults to PR/source/current branch.')
    string(name: 'BITBUCKET_CREDENTIALS_ID', defaultValue: 'bit-bucket-app-password-template', description: 'Jenkins username/password credential for pushing generated Postman artifacts to Bitbucket.')
    choice(name: 'BITBUCKET_PR_COMMENT_AUTH_TYPE', choices: ['username-password', 'bearer-token', 'none'], description: 'Credential type used to write API Governance comments and tasks on Bitbucket pull requests.')
    string(name: 'BITBUCKET_PR_COMMENT_CREDENTIALS_ID', defaultValue: 'template_repo_bb_admin', description: 'Optional Jenkins credential ID used to write Bitbucket PR Governance comments and tasks.')
    booleanParam(name: 'BITBUCKET_PR_CREATE_BLOCKING_TASK', defaultValue: true, description: 'Create or resolve a Bitbucket PR task for Governance failures. Requires Bitbucket merge checks to block on open tasks.')
    text(name: 'POSTMAN_RUNTIME_URLS_JSON', defaultValue: '{"TEST":"http://localhost:3000","STAGE":"https://stage.example.com","PROD":"https://api.example.com"}', description: 'JSON object mapping Postman environment names to base URLs.')
    text(name: 'POSTMAN_GOVERNANCE_GROUPS_JSON', defaultValue: '{"sample-domain":"api-governance-group"}', description: 'JSON object mapping project.domain values to Postman Governance group names.')
    string(name: 'POSTMAN_CONTRACT_ENVIRONMENT', defaultValue: 'TEST', description: 'Environment name used for local Contract collection runs. Must exist in POSTMAN_RUNTIME_URLS_JSON.')
    string(name: 'POSTMAN_SMOKE_ENVIRONMENT', defaultValue: 'STAGE', description: 'Environment name used for Smoke collection runs. Must exist in POSTMAN_RUNTIME_URLS_JSON.')
    booleanParam(name: 'RUN_STAGE_SMOKE', defaultValue: false, description: 'Run the Smoke collection against POSTMAN_SMOKE_ENVIRONMENT.')
  }

  environment {
    POSTMAN_CI_CONFIG_PATH = '.postman-ci/config.yaml'
    POSTMAN_BOOTSTRAP = '.postman-ci/scripts/run-postman-bootstrap-cli.cjs'
    POSTMAN_REPO_SYNC = '.postman-ci/scripts/run-postman-repo-sync-cli.cjs'
    POSTMAN_CLI_PACKAGE = 'postman-cli@1.38.0'
    OPENAPI_CHANGES_VERSION = '0.2.7'
    POSTMAN_CSE_AUTHOR = 'Postman CSE'
    POSTMAN_CSE_AUTHOR_EMAIL = 'help@postman.com'
    POSTMAN_GENERATED_ARTIFACT_COMMIT_MESSAGE = 'chore: sync Postman artifacts and metadata'
  }

  stages {
    stage('Generated Artifact Commit Guard') {
      when {
        expression {
          return isGeneratedArtifactOnlyBuild()
        }
      }
      steps {
        echo 'Detected a generated Postman artifact-only commit. Skipping onboarding stages to prevent a build loop.'
      }
    }

    stage('Install Tooling') {
      when {
        expression {
          return isPullRequestBuild() || shouldRunMainOnboardingBuild()
        }
      }
      steps {
        script {
          checkoutTrustedPostmanCiForPullRequest()
          env.POSTMAN_CI_IS_MAIN_BUILD = shouldRunMainOnboardingBuild() ? 'true' : 'false'
          def workspacePath = pwd()
          def postmanCliBin = "${workspacePath}/.jenkins-tools/postman-cli/node_modules/.bin"
          def openapiChangesBin = "${workspacePath}/.jenkins-tools/openapi-changes/bin"
          if (!isUnix()) {
            postmanCliBin = "${workspacePath}\\.jenkins-tools\\postman-cli\\node_modules\\.bin"
            openapiChangesBin = "${workspacePath}\\.jenkins-tools\\openapi-changes\\bin"
          }
          env.PATH = "${postmanCliBin}${isUnix() ? ':' : ';'}${openapiChangesBin}${isUnix() ? ':' : ';'}${env.PATH}"
          runCiScript(
            '''#!/usr/bin/env bash
set -euo pipefail

rm -f bitbucket-repo.env bitbucket-repo.ps1 lint-results.json lint-stderr.log lint-summary.md openapi-changes-summary.md openapi-changes.log postman-*.env postman-*.ps1 postman-*-result.json postman-service*.log

npm ci --prefix .postman-ci --ignore-scripts
node .postman-ci/scripts/install-openapi-changes.mjs
node .postman-ci/scripts/emit-config-env.mjs > postman-ci.env
. ./postman-ci.env

if [ "${POSTMAN_CI_IS_MAIN_BUILD:-false}" = "true" ]; then
  node .postman-ci/scripts/resolve-runtime-env.mjs > postman-runtime.env
  . ./postman-runtime.env
fi

if ! command -v postman >/dev/null 2>&1; then
  npm install --prefix .jenkins-tools/postman-cli "$POSTMAN_CLI_PACKAGE" --ignore-scripts --no-audit --no-fund
fi

postman --version
openapi-changes version
''',
            '''
$ErrorActionPreference = 'Stop'

Remove-Item -Force -ErrorAction SilentlyContinue bitbucket-repo.env, bitbucket-repo.ps1, lint-results.json, lint-stderr.log, lint-summary.md, openapi-changes-summary.md, openapi-changes.log, postman-*.env, postman-*.ps1, postman-*-result.json, postman-service*.log

npm ci --prefix .postman-ci --ignore-scripts
node .postman-ci/scripts/install-openapi-changes.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node .postman-ci/scripts/emit-config-env.mjs --format=ps1 | Set-Content -Encoding utf8 -Path postman-ci.ps1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
. .\\postman-ci.ps1

if ($env:POSTMAN_CI_IS_MAIN_BUILD -eq 'true') {
  node .postman-ci/scripts/resolve-runtime-env.mjs --format=ps1 | Set-Content -Encoding utf8 -Path postman-runtime.ps1
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  . .\\postman-runtime.ps1
}

if (-not (Get-Command postman -ErrorAction SilentlyContinue)) {
  npm install --prefix .jenkins-tools/postman-cli $env:POSTMAN_CLI_PACKAGE --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

postman --version
openapi-changes version
'''
          )
        }
      }
    }

    stage('Install Service Dependencies') {
      when {
        expression {
          return shouldRunMainOnboardingBuild()
        }
      }
      steps {
        script {
          runCiScript(
            '''#!/usr/bin/env bash
set -euo pipefail

. ./postman-ci.env
if [ -n "${POSTMAN_CI_APP_INSTALL_COMMAND:-}" ]; then
  bash -lc "$POSTMAN_CI_APP_INSTALL_COMMAND"
fi
''',
            '''
$ErrorActionPreference = 'Stop'

. .\\postman-ci.ps1
if (-not [string]::IsNullOrWhiteSpace($env:POSTMAN_CI_APP_INSTALL_COMMAND)) {
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $env:POSTMAN_CI_APP_INSTALL_COMMAND
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
'''
          )
        }
      }
    }

    stage('Gated CI') {
      when {
        expression {
          return shouldRunMainOnboardingBuild()
        }
      }
      steps {
        script {
          runCiScript(
            '''#!/usr/bin/env bash
set -euo pipefail

. ./postman-ci.env
node .postman-ci/scripts/validate-specs.mjs
node .postman-ci/scripts/check-breaking.mjs

if [ -n "${POSTMAN_CI_APP_BUILD_COMMAND:-}" ]; then
  bash -lc "$POSTMAN_CI_APP_BUILD_COMMAND"
fi
''',
            '''
$ErrorActionPreference = 'Stop'

. .\\postman-ci.ps1
node .postman-ci/scripts/validate-specs.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node .postman-ci/scripts/check-breaking.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not [string]::IsNullOrWhiteSpace($env:POSTMAN_CI_APP_BUILD_COMMAND)) {
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $env:POSTMAN_CI_APP_BUILD_COMMAND
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
'''
          )
        }
      }
    }

    stage('PR Governance Check') {
      when {
        expression {
          if (!isPullRequestBuild()) {
            return false
          }

          return captureCiScript(
            'node .postman-ci/scripts/has-contract-changes.mjs',
            'node .postman-ci/scripts/has-contract-changes.mjs'
          ) == 'true'
        }
      }
      steps {
        script {
          runCiScript(
            'node .postman-ci/scripts/has-contract-changes.mjs --list',
            'node .postman-ci/scripts/has-contract-changes.mjs --list'
          )
        }
        script {
          if (!isTrustedPullRequestBuild()) {
            echo 'Skipping credentialed Postman Governance lint for an untrusted fork pull request.'
            runCiScript(
              '''#!/usr/bin/env bash
set -euo pipefail

node .postman-ci/scripts/validate-specs.mjs
node .postman-ci/scripts/check-breaking.mjs --summary openapi-changes-summary.md --log openapi-changes.log
''',
              '''
$ErrorActionPreference = 'Stop'

node .postman-ci/scripts/validate-specs.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node .postman-ci/scripts/check-breaking.mjs --summary openapi-changes-summary.md --log openapi-changes.log
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
'''
            )
            return
          }
        }
        script {
          if (!isTrustedPullRequestBuild()) {
            return
          }

          def runGovernanceLint = {
            runCiScript(
              '''#!/usr/bin/env bash
set -euo pipefail

. ./postman-ci.env
node .postman-ci/scripts/validate-specs.mjs
set +e
node .postman-ci/scripts/check-breaking.mjs --summary openapi-changes-summary.md --log openapi-changes.log
BREAKING_EXIT=$?
set -e

node .postman-ci/scripts/postman-resource-env.mjs > postman-pr-resources.env
. ./postman-pr-resources.env
postman login --with-api-key "$POSTMAN_API_KEY"

LINT_ARGS=("$POSTMAN_CI_BUNDLED_SPEC_PATH" --fail-severity WARNING -o json)
if [ -n "${POSTMAN_WORKSPACE_ID:-}" ]; then
  echo "Running Postman Governance lint against workspace $POSTMAN_WORKSPACE_ID."
  LINT_ARGS+=(--workspace-id "$POSTMAN_WORKSPACE_ID")
else
  echo "No Postman workspace ID found in $POSTMAN_CI_RESOURCES_PATH; running file-based Postman Governance lint."
fi

set +e
postman spec lint "${LINT_ARGS[@]}" > lint-results.json 2> lint-stderr.log
LINT_EXIT=$?
set -e

node .postman-ci/scripts/report-governance-lint.mjs \
  --lint-results lint-results.json \
  --lint-stderr lint-stderr.log \
  --lint-exit "$LINT_EXIT" \
  --breaking-summary openapi-changes-summary.md \
  --breaking-log openapi-changes.log \
  --breaking-exit "$BREAKING_EXIT"
if [ "$LINT_EXIT" -ne 0 ] || [ "$BREAKING_EXIT" -ne 0 ]; then
  exit 1
fi
''',
              '''
$ErrorActionPreference = 'Stop'

. .\\postman-ci.ps1
node .postman-ci/scripts/validate-specs.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node .postman-ci/scripts/check-breaking.mjs --summary openapi-changes-summary.md --log openapi-changes.log
$breakingExit = $LASTEXITCODE

node .postman-ci/scripts/postman-resource-env.mjs --format=ps1 | Set-Content -Encoding utf8 -Path postman-pr-resources.ps1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
. .\\postman-pr-resources.ps1
postman login --with-api-key $env:POSTMAN_API_KEY

$LintArgs = @('spec', 'lint', $env:POSTMAN_CI_BUNDLED_SPEC_PATH, '--fail-severity', 'WARNING', '-o', 'json')
if (-not [string]::IsNullOrWhiteSpace($env:POSTMAN_WORKSPACE_ID)) {
  Write-Host "Running Postman Governance lint against workspace $env:POSTMAN_WORKSPACE_ID."
  $LintArgs += @('--workspace-id', $env:POSTMAN_WORKSPACE_ID)
} else {
  Write-Host "No Postman workspace ID found in $env:POSTMAN_CI_RESOURCES_PATH; running file-based Postman Governance lint."
}

& postman @LintArgs > lint-results.json 2> lint-stderr.log
$lintExit = $LASTEXITCODE

node .postman-ci/scripts/report-governance-lint.mjs --lint-results lint-results.json --lint-stderr lint-stderr.log --lint-exit $lintExit --breaking-summary openapi-changes-summary.md --breaking-log openapi-changes.log --breaking-exit $breakingExit
if (($lintExit -ne 0) -or ($breakingExit -ne 0)) {
  exit 1
}
'''
            )
          }

          def prCommentCredentialsId = params.BITBUCKET_PR_COMMENT_CREDENTIALS_ID?.trim()
          if (prCommentCredentialsId && params.BITBUCKET_PR_COMMENT_AUTH_TYPE == 'bearer-token') {
            withCredentials([
              string(credentialsId: 'postman-api-key', variable: 'POSTMAN_API_KEY'),
              string(credentialsId: prCommentCredentialsId, variable: 'BITBUCKET_BEARER_TOKEN')
            ]) {
              runGovernanceLint()
            }
          } else if (prCommentCredentialsId && params.BITBUCKET_PR_COMMENT_AUTH_TYPE == 'username-password') {
            withCredentials([
              string(credentialsId: 'postman-api-key', variable: 'POSTMAN_API_KEY'),
              usernamePassword(credentialsId: prCommentCredentialsId, usernameVariable: 'BITBUCKET_USERNAME', passwordVariable: 'BITBUCKET_APP_PASSWORD')
            ]) {
              runGovernanceLint()
            }
          } else {
            withCredentials([string(credentialsId: 'postman-api-key', variable: 'POSTMAN_API_KEY')]) {
              runGovernanceLint()
            }
          }
        }
      }
    }

    stage('Postman Bootstrap or Update') {
      when {
        expression {
          return shouldRunMainOnboardingBuild()
        }
      }
      steps {
        withCredentials([
          string(credentialsId: 'postman-api-key', variable: 'POSTMAN_API_KEY'),
          string(credentialsId: 'postman-access-token', variable: 'POSTMAN_ACCESS_TOKEN')
        ]) {
          script {
            runCiScript(
              '''#!/usr/bin/env bash
set -euo pipefail

. ./postman-ci.env
. ./postman-runtime.env
ONBOARDING_MODE="$(node .postman-ci/scripts/onboarding-mode.mjs "$POSTMAN_ONBOARDING_MODE")"
echo "Postman onboarding mode: $ONBOARDING_MODE"

if [ "$ONBOARDING_MODE" = "update" ]; then
  node .postman-ci/scripts/postman-resource-env.mjs --require=workspace,spec,baseline,smoke,contract > postman-resources.env
else
  node .postman-ci/scripts/postman-resource-env.mjs > postman-resources.env
fi
. ./postman-resources.env

node .postman-ci/scripts/bitbucket-repo-context.mjs > bitbucket-repo.env
. ./bitbucket-repo.env

REPO_SYNC_WRITE_MODE="$POSTMAN_REPO_WRITE_MODE"
if [ "$REPO_SYNC_WRITE_MODE" = "commit-and-push" ]; then
  REPO_SYNC_WRITE_MODE="commit-only"
fi
if [ -z "${POSTMAN_CI_GOVERNANCE_GROUP:-}" ]; then
  echo "POSTMAN_CI_GOVERNANCE_GROUP could not be resolved from POSTMAN_GOVERNANCE_GROUPS_JSON." >&2
  exit 1
fi

BOOTSTRAP_ARGS=(
  --project-name "$POSTMAN_CI_PROJECT_NAME"
  --collection-sync-mode refresh
  --spec-sync-mode update
  --spec-path "$POSTMAN_CI_BUNDLED_SPEC_PATH"
  --domain "$POSTMAN_CI_DOMAIN"
  --domain-code "$POSTMAN_CI_DOMAIN_CODE"
  --governance-group "$POSTMAN_CI_GOVERNANCE_GROUP"
  --requester-email "$POSTMAN_CI_REQUESTER_EMAIL"
  --postman-api-key "$POSTMAN_API_KEY"
  --postman-access-token "$POSTMAN_ACCESS_TOKEN"
  --result-json postman-bootstrap-result.json
  --dotenv-path postman-bootstrap.env
)

add_arg_if_value() {
  local name="$1"
  local value="$2"
  if [ -n "$value" ]; then
    BOOTSTRAP_ARGS+=("$name" "$value")
  fi
}

add_arg_if_value --workspace-id "${POSTMAN_WORKSPACE_ID:-}"
add_arg_if_value --spec-id "${POSTMAN_SPEC_ID:-}"
add_arg_if_value --baseline-collection-id "${POSTMAN_BASELINE_COLLECTION_ID:-}"
add_arg_if_value --smoke-collection-id "${POSTMAN_SMOKE_COLLECTION_ID:-}"
add_arg_if_value --contract-collection-id "${POSTMAN_CONTRACT_COLLECTION_ID:-}"

node "$POSTMAN_BOOTSTRAP" "${BOOTSTRAP_ARGS[@]}"
. ./postman-bootstrap.env

mkdir -p .debug/postman-smoke-flow
SMOKE_FLOW_COLLECTION_ID="$POSTMAN_BOOTSTRAP_SMOKE_COLLECTION_ID"
if [ -n "${POSTMAN_CI_SMOKE_FLOW_PATH:-}" ] && [ -f "$POSTMAN_CI_SMOKE_FLOW_PATH" ]; then
  node .postman-ci/vendor/postman-smoke-flow.cjs \
    --project-name "$POSTMAN_CI_PROJECT_NAME" \
    --workspace-id "$POSTMAN_BOOTSTRAP_WORKSPACE_ID" \
    --spec-id "$POSTMAN_BOOTSTRAP_SPEC_ID" \
    --smoke-collection-id "$POSTMAN_BOOTSTRAP_SMOKE_COLLECTION_ID" \
    --flow-path "$POSTMAN_CI_SMOKE_FLOW_PATH" \
    --spec-path "$POSTMAN_CI_SOURCE_SPEC_PATH" \
    --debug-dump-path .debug/postman-smoke-flow/curated-smoke-collection.json \
    --postman-api-key "$POSTMAN_API_KEY" > postman-smoke-flow-result.json

  SMOKE_FLOW_COLLECTION_ID="$(
    node -e "const fs=require('fs'); const o=JSON.parse(fs.readFileSync('postman-smoke-flow-result.json','utf8')); process.stdout.write(o['smoke-collection-id'] || process.env.POSTMAN_BOOTSTRAP_SMOKE_COLLECTION_ID || '')"
  )"
fi
if [ -z "$SMOKE_FLOW_COLLECTION_ID" ]; then
  echo "Smoke collection ID could not be resolved." >&2
  exit 1
fi

export INPUT_ENVIRONMENTS_JSON="$POSTMAN_CI_ENVIRONMENTS_JSON"
export INPUT_ENV_RUNTIME_URLS_JSON="$POSTMAN_CI_RUNTIME_URLS_JSON"

REPO_SYNC_ARGS=(
  --project-name "$POSTMAN_CI_PROJECT_NAME"
  --workspace-id "$POSTMAN_BOOTSTRAP_WORKSPACE_ID"
  --baseline-collection-id "$POSTMAN_BOOTSTRAP_BASELINE_COLLECTION_ID"
  --smoke-collection-id "$SMOKE_FLOW_COLLECTION_ID"
  --contract-collection-id "$POSTMAN_BOOTSTRAP_CONTRACT_COLLECTION_ID"
  --collection-sync-mode refresh
  --spec-sync-mode update
  --generate-ci-workflow false
  --monitor-type cli
  --workspace-link-enabled false
  --environment-sync-enabled false
  --repo-write-mode "$REPO_SYNC_WRITE_MODE"
  --repository "$BITBUCKET_REPOSITORY_SLUG"
  --postman-api-key "$POSTMAN_API_KEY"
  --postman-access-token "$POSTMAN_ACCESS_TOKEN"
  --spec-id "$POSTMAN_BOOTSTRAP_SPEC_ID"
  --spec-path "$POSTMAN_CI_SOURCE_SPEC_PATH"
  --result-json postman-repo-sync-result.json
  --dotenv-path postman-repo-sync.env
)

node "$POSTMAN_REPO_SYNC" "${REPO_SYNC_ARGS[@]}"
CONTRACT_ENV_KEY="$(printf '%s' "$POSTMAN_CI_CONTRACT_ENVIRONMENT_NAME" | tr '[:upper:]' '[:lower:]')"
SMOKE_ENV_KEY="$(printf '%s' "$POSTMAN_CI_SMOKE_ENVIRONMENT_NAME" | tr '[:upper:]' '[:lower:]')"
node .postman-ci/scripts/postman-resource-env.mjs --require="contract,smoke,$CONTRACT_ENV_KEY,$SMOKE_ENV_KEY" > postman-resources.env
''',
              '''
$ErrorActionPreference = 'Stop'

function Assert-NativeSuccess {
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

function Import-DotEnvFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) {
      return
    }
    if ($line.StartsWith('export ')) {
      $line = $line.Substring(7).Trim()
    }

    $separatorIndex = $line.IndexOf('=')
    if ($separatorIndex -lt 1) {
      return
    }

    $name = $line.Substring(0, $separatorIndex).Trim()
    $value = $line.Substring($separatorIndex + 1).Trim()
    if (($value.StartsWith("'") -and $value.EndsWith("'")) -or ($value.StartsWith('"') -and $value.EndsWith('"'))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    Set-Item -Path "Env:$name" -Value $value
  }
}

. .\\postman-ci.ps1
. .\\postman-runtime.ps1
$OnboardingMode = node .postman-ci/scripts/onboarding-mode.mjs $env:POSTMAN_ONBOARDING_MODE
Assert-NativeSuccess
$OnboardingMode = ($OnboardingMode | Select-Object -First 1).Trim()
Write-Host "Postman onboarding mode: $OnboardingMode"

if ($OnboardingMode -eq 'update') {
  node .postman-ci/scripts/postman-resource-env.mjs --format=ps1 --require=workspace,spec,baseline,smoke,contract | Set-Content -Encoding utf8 -Path postman-resources.ps1
} else {
  node .postman-ci/scripts/postman-resource-env.mjs --format=ps1 | Set-Content -Encoding utf8 -Path postman-resources.ps1
}
Assert-NativeSuccess
. .\\postman-resources.ps1

node .postman-ci/scripts/bitbucket-repo-context.mjs --format=ps1 | Set-Content -Encoding utf8 -Path bitbucket-repo.ps1
Assert-NativeSuccess
. .\\bitbucket-repo.ps1

$RepoSyncWriteMode = $env:POSTMAN_REPO_WRITE_MODE
if ($RepoSyncWriteMode -eq 'commit-and-push') {
  $RepoSyncWriteMode = 'commit-only'
}
if ([string]::IsNullOrWhiteSpace($env:POSTMAN_CI_GOVERNANCE_GROUP)) {
  throw 'POSTMAN_CI_GOVERNANCE_GROUP could not be resolved from POSTMAN_GOVERNANCE_GROUPS_JSON.'
}

$BootstrapArgs = @(
  '--project-name', $env:POSTMAN_CI_PROJECT_NAME,
  '--collection-sync-mode', 'refresh',
  '--spec-sync-mode', 'update',
  '--spec-path', $env:POSTMAN_CI_BUNDLED_SPEC_PATH,
  '--domain', $env:POSTMAN_CI_DOMAIN,
  '--domain-code', $env:POSTMAN_CI_DOMAIN_CODE,
  '--governance-group', $env:POSTMAN_CI_GOVERNANCE_GROUP,
  '--requester-email', $env:POSTMAN_CI_REQUESTER_EMAIL,
  '--postman-api-key', $env:POSTMAN_API_KEY,
  '--postman-access-token', $env:POSTMAN_ACCESS_TOKEN,
  '--result-json', 'postman-bootstrap-result.json',
  '--dotenv-path', 'postman-bootstrap.env'
)

function Add-ArgIfValue {
  param([string]$Name, [string]$Value)
  if (-not [string]::IsNullOrWhiteSpace($Value)) {
    $script:BootstrapArgs += @($Name, $Value)
  }
}

Add-ArgIfValue '--workspace-id' $env:POSTMAN_WORKSPACE_ID
Add-ArgIfValue '--spec-id' $env:POSTMAN_SPEC_ID
Add-ArgIfValue '--baseline-collection-id' $env:POSTMAN_BASELINE_COLLECTION_ID
Add-ArgIfValue '--smoke-collection-id' $env:POSTMAN_SMOKE_COLLECTION_ID
Add-ArgIfValue '--contract-collection-id' $env:POSTMAN_CONTRACT_COLLECTION_ID

node $env:POSTMAN_BOOTSTRAP @BootstrapArgs
Assert-NativeSuccess
Import-DotEnvFile 'postman-bootstrap.env'

New-Item -ItemType Directory -Force -Path '.debug\\postman-smoke-flow' | Out-Null
$SmokeFlowCollectionId = $env:POSTMAN_BOOTSTRAP_SMOKE_COLLECTION_ID
if ((-not [string]::IsNullOrWhiteSpace($env:POSTMAN_CI_SMOKE_FLOW_PATH)) -and (Test-Path -LiteralPath $env:POSTMAN_CI_SMOKE_FLOW_PATH)) {
  $SmokeFlowOutput = node .postman-ci/vendor/postman-smoke-flow.cjs `
    --project-name $env:POSTMAN_CI_PROJECT_NAME `
    --workspace-id $env:POSTMAN_BOOTSTRAP_WORKSPACE_ID `
    --spec-id $env:POSTMAN_BOOTSTRAP_SPEC_ID `
    --smoke-collection-id $env:POSTMAN_BOOTSTRAP_SMOKE_COLLECTION_ID `
    --flow-path $env:POSTMAN_CI_SMOKE_FLOW_PATH `
    --spec-path $env:POSTMAN_CI_SOURCE_SPEC_PATH `
    --debug-dump-path '.debug/postman-smoke-flow/curated-smoke-collection.json' `
    --postman-api-key $env:POSTMAN_API_KEY
  $SmokeFlowExit = $LASTEXITCODE
  $SmokeFlowOutput | Set-Content -Encoding utf8 -Path postman-smoke-flow-result.json
  if ($SmokeFlowExit -ne 0) {
    exit $SmokeFlowExit
  }

  $SmokeFlowJson = ($SmokeFlowOutput -join "`n") | ConvertFrom-Json
  $SmokeFlowCollectionId = $SmokeFlowJson.'smoke-collection-id'
}
if ([string]::IsNullOrWhiteSpace($SmokeFlowCollectionId)) {
  throw 'Smoke collection ID could not be resolved.'
}

$env:INPUT_ENVIRONMENTS_JSON = $env:POSTMAN_CI_ENVIRONMENTS_JSON
$env:INPUT_ENV_RUNTIME_URLS_JSON = $env:POSTMAN_CI_RUNTIME_URLS_JSON

$RepoSyncArgs = @(
  '--project-name', $env:POSTMAN_CI_PROJECT_NAME,
  '--workspace-id', $env:POSTMAN_BOOTSTRAP_WORKSPACE_ID,
  '--baseline-collection-id', $env:POSTMAN_BOOTSTRAP_BASELINE_COLLECTION_ID,
  '--smoke-collection-id', $SmokeFlowCollectionId,
  '--contract-collection-id', $env:POSTMAN_BOOTSTRAP_CONTRACT_COLLECTION_ID,
  '--collection-sync-mode', 'refresh',
  '--spec-sync-mode', 'update',
  '--generate-ci-workflow', 'false',
  '--monitor-type', 'cli',
  '--workspace-link-enabled', 'false',
  '--environment-sync-enabled', 'false',
  '--repo-write-mode', $RepoSyncWriteMode,
  '--repository', $env:BITBUCKET_REPOSITORY_SLUG,
  '--postman-api-key', $env:POSTMAN_API_KEY,
  '--postman-access-token', $env:POSTMAN_ACCESS_TOKEN,
  '--spec-id', $env:POSTMAN_BOOTSTRAP_SPEC_ID,
  '--spec-path', $env:POSTMAN_CI_SOURCE_SPEC_PATH,
  '--result-json', 'postman-repo-sync-result.json',
  '--dotenv-path', 'postman-repo-sync.env'
)

node $env:POSTMAN_REPO_SYNC @RepoSyncArgs
Assert-NativeSuccess
$ContractEnvKey = $env:POSTMAN_CI_CONTRACT_ENVIRONMENT_NAME.ToLowerInvariant()
$SmokeEnvKey = $env:POSTMAN_CI_SMOKE_ENVIRONMENT_NAME.ToLowerInvariant()
node .postman-ci/scripts/postman-resource-env.mjs --format=ps1 --require="contract,smoke,$ContractEnvKey,$SmokeEnvKey" | Set-Content -Encoding utf8 -Path postman-resources.ps1
Assert-NativeSuccess
'''
            )
          }
        }
      }
    }

    stage('Local Contract Collection') {
      when {
        allOf {
          expression {
            return shouldRunMainOnboardingBuild()
          }
          expression {
            return captureCiScript(
              'test -f postman-resources.env && test "$(node .postman-ci/scripts/print-config-value.mjs runLocalContract)" = "true" && test -n "$(node .postman-ci/scripts/print-config-value.mjs localStartCommand)" && echo true || echo false',
              'if ((Test-Path -LiteralPath "postman-resources.ps1") -and ((node .postman-ci/scripts/print-config-value.mjs runLocalContract) -eq "true") -and (-not [string]::IsNullOrWhiteSpace((node .postman-ci/scripts/print-config-value.mjs localStartCommand)))) { "true" } else { "false" }'
            ) == 'true'
          }
        }
      }
      steps {
        withCredentials([string(credentialsId: 'postman-api-key', variable: 'POSTMAN_API_KEY')]) {
          script {
            runCiScript(
              '''#!/usr/bin/env bash
set -euo pipefail

. ./postman-ci.env
. ./postman-runtime.env
. ./postman-resources.env
postman login --with-api-key "$POSTMAN_API_KEY"

CONTRACT_ENV_VAR="POSTMAN_${POSTMAN_CI_CONTRACT_ENVIRONMENT_NAME}_ENVIRONMENT_ID"
CONTRACT_ENV_ID="${!CONTRACT_ENV_VAR:-}"
if [ -z "$CONTRACT_ENV_ID" ]; then
  echo "Unable to resolve Contract environment ID from $CONTRACT_ENV_VAR." >&2
  exit 1
fi

bash -lc "$POSTMAN_CI_LOCAL_START_COMMAND" > postman-service.log 2>&1 &
APP_PID=$!
cleanup() {
  kill "$APP_PID" >/dev/null 2>&1 || true
  wait "$APP_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

node .postman-ci/scripts/wait-for-url.mjs "${POSTMAN_CI_LOCAL_HEALTH_URL:-$POSTMAN_CI_LOCAL_BASE_URL}" "$POSTMAN_CI_LOCAL_READY_TIMEOUT_SECONDS"

postman collection run "$POSTMAN_CONTRACT_COLLECTION_ID" \
  -e "$CONTRACT_ENV_ID" \
  --report-events \
  --env-var CI=true \
  --env-var "baseUrl=$POSTMAN_CI_LOCAL_BASE_URL"
''',
              '''
$ErrorActionPreference = 'Stop'

function Assert-NativeSuccess {
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

. .\\postman-ci.ps1
. .\\postman-runtime.ps1
. .\\postman-resources.ps1
postman login --with-api-key $env:POSTMAN_API_KEY
Assert-NativeSuccess

$ContractEnvVar = "POSTMAN_$($env:POSTMAN_CI_CONTRACT_ENVIRONMENT_NAME.ToUpperInvariant())_ENVIRONMENT_ID"
$ContractEnvId = [Environment]::GetEnvironmentVariable($ContractEnvVar)
if ([string]::IsNullOrWhiteSpace($ContractEnvId)) {
  throw "Unable to resolve Contract environment ID from $ContractEnvVar."
}

$ServiceProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $env:POSTMAN_CI_LOCAL_START_COMMAND) -PassThru -RedirectStandardOutput postman-service.log -RedirectStandardError postman-service.err.log
try {
  $ReadyUrl = if ([string]::IsNullOrWhiteSpace($env:POSTMAN_CI_LOCAL_HEALTH_URL)) { $env:POSTMAN_CI_LOCAL_BASE_URL } else { $env:POSTMAN_CI_LOCAL_HEALTH_URL }
  node .postman-ci/scripts/wait-for-url.mjs $ReadyUrl $env:POSTMAN_CI_LOCAL_READY_TIMEOUT_SECONDS
  Assert-NativeSuccess

  postman collection run $env:POSTMAN_CONTRACT_COLLECTION_ID -e $ContractEnvId --report-events --env-var CI=true --env-var "baseUrl=$env:POSTMAN_CI_LOCAL_BASE_URL"
  Assert-NativeSuccess
} finally {
  if ($ServiceProcess -and -not $ServiceProcess.HasExited) {
    Stop-Process -Id $ServiceProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
'''
            )
          }
        }
      }
    }

    stage('Stage Smoke Collection') {
      when {
        allOf {
          expression {
            return shouldRunMainOnboardingBuild()
          }
          expression { return params.RUN_STAGE_SMOKE }
          expression {
            return captureCiScript(
              'test -f postman-resources.env && test "$(node .postman-ci/scripts/print-config-value.mjs runStageSmoke)" = "true" && echo true || echo false',
              'if ((Test-Path -LiteralPath "postman-resources.ps1") -and ((node .postman-ci/scripts/print-config-value.mjs runStageSmoke) -eq "true")) { "true" } else { "false" }'
            ) == 'true'
          }
        }
      }
      steps {
        withCredentials([string(credentialsId: 'postman-api-key', variable: 'POSTMAN_API_KEY')]) {
          script {
            runCiScript(
              '''#!/usr/bin/env bash
set -euo pipefail

. ./postman-runtime.env
. ./postman-resources.env
postman login --with-api-key "$POSTMAN_API_KEY"

SMOKE_ENV_VAR="POSTMAN_${POSTMAN_CI_SMOKE_ENVIRONMENT_NAME}_ENVIRONMENT_ID"
SMOKE_ENV_ID="${!SMOKE_ENV_VAR:-}"
if [ -z "$SMOKE_ENV_ID" ]; then
  echo "Unable to resolve Smoke environment ID from $SMOKE_ENV_VAR." >&2
  exit 1
fi

postman collection run "$POSTMAN_SMOKE_COLLECTION_ID" \
  -e "$SMOKE_ENV_ID" \
  --report-events \
  --env-var CI=true
''',
              '''
$ErrorActionPreference = 'Stop'

function Assert-NativeSuccess {
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

. .\\postman-runtime.ps1
. .\\postman-resources.ps1
postman login --with-api-key $env:POSTMAN_API_KEY
Assert-NativeSuccess

$SmokeEnvVar = "POSTMAN_$($env:POSTMAN_CI_SMOKE_ENVIRONMENT_NAME.ToUpperInvariant())_ENVIRONMENT_ID"
$SmokeEnvId = [Environment]::GetEnvironmentVariable($SmokeEnvVar)
if ([string]::IsNullOrWhiteSpace($SmokeEnvId)) {
  throw "Unable to resolve Smoke environment ID from $SmokeEnvVar."
}

postman collection run $env:POSTMAN_SMOKE_COLLECTION_ID -e $SmokeEnvId --report-events --env-var CI=true
Assert-NativeSuccess
'''
            )
          }
        }
      }
    }

    stage('Push Postman Artifacts') {
      when {
        allOf {
          expression {
            return shouldRunMainOnboardingBuild()
          }
          expression {
            return params.POSTMAN_REPO_WRITE_MODE == 'commit-and-push'
          }
          expression {
            return captureCiScript(
              'test -f postman-repo-sync.env && test -f bitbucket-repo.env && echo true || echo false',
              'if ((Test-Path -LiteralPath "postman-repo-sync.env") -and (Test-Path -LiteralPath "bitbucket-repo.ps1")) { "true" } else { "false" }'
            ) == 'true'
          }
        }
      }
      steps {
        script {
          if (!params.BITBUCKET_CREDENTIALS_ID?.trim()) {
            error('BITBUCKET_CREDENTIALS_ID is required when POSTMAN_REPO_WRITE_MODE=commit-and-push')
          }
          withCredentials([usernamePassword(credentialsId: params.BITBUCKET_CREDENTIALS_ID, usernameVariable: 'BITBUCKET_USERNAME', passwordVariable: 'BITBUCKET_APP_PASSWORD')]) {
            runCiScript(
              '''#!/usr/bin/env bash
set -euo pipefail

. ./postman-repo-sync.env
. ./bitbucket-repo.env

if [ -z "${POSTMAN_REPO_SYNC_COMMIT_SHA:-}" ]; then
  echo "repo-sync did not create a generated artifact commit; nothing to push."
  exit 0
fi

git cat-file -e "${POSTMAN_REPO_SYNC_COMMIT_SHA}^{commit}"

PUSH_BRANCH="${POSTMAN_PUSH_BRANCH:-}"
if [ -z "$PUSH_BRANCH" ]; then
  PUSH_BRANCH="${CHANGE_BRANCH:-${BITBUCKET_SOURCE_BRANCH:-${BITBUCKET_BRANCH:-${BRANCH_NAME:-}}}}"
fi
if [[ "$PUSH_BRANCH" == refs/heads/* ]]; then
  PUSH_BRANCH="${PUSH_BRANCH#refs/heads/}"
fi
if [[ "$PUSH_BRANCH" == PR-* || "$PUSH_BRANCH" == */merge ]]; then
  PUSH_BRANCH=""
fi
if [ -z "$PUSH_BRANCH" ]; then
  PUSH_BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
fi
if [ -z "$PUSH_BRANCH" ]; then
  echo "Unable to resolve a Bitbucket push branch. Set POSTMAN_PUSH_BRANCH." >&2
  exit 1
fi
git check-ref-format --branch "$PUSH_BRANCH" >/dev/null

ORIGINAL_ORIGIN_URL="$(git remote get-url origin)"
ASKPASS_SCRIPT="$PWD/.git/bitbucket-askpass.sh"
restore_origin() {
  git remote set-url origin "$ORIGINAL_ORIGIN_URL" >/dev/null 2>&1 || true
  rm -f "$ASKPASS_SCRIPT"
}
trap restore_origin EXIT

cat > "$ASKPASS_SCRIPT" <<'ASKPASS'
#!/usr/bin/env bash
case "$1" in
  *Username*) printf '%s\\n' "$BITBUCKET_USERNAME" ;;
  *Password*) printf '%s\\n' "$BITBUCKET_APP_PASSWORD" ;;
  *) printf '%s\\n' "$BITBUCKET_APP_PASSWORD" ;;
esac
ASKPASS
chmod 700 "$ASKPASS_SCRIPT"

git remote set-url origin "$BITBUCKET_HTTPS_REMOTE_URL"
GIT_TERMINAL_PROMPT=0 GIT_ASKPASS="$ASKPASS_SCRIPT" \
  git push origin "${POSTMAN_REPO_SYNC_COMMIT_SHA}:refs/heads/${PUSH_BRANCH}"
''',
              '''
$ErrorActionPreference = 'Stop'

function Assert-NativeSuccess {
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

function Import-DotEnvFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) {
      return
    }
    if ($line.StartsWith('export ')) {
      $line = $line.Substring(7).Trim()
    }

    $separatorIndex = $line.IndexOf('=')
    if ($separatorIndex -lt 1) {
      return
    }

    $name = $line.Substring(0, $separatorIndex).Trim()
    $value = $line.Substring($separatorIndex + 1).Trim()
    if (($value.StartsWith("'") -and $value.EndsWith("'")) -or ($value.StartsWith('"') -and $value.EndsWith('"'))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    Set-Item -Path "Env:$name" -Value $value
  }
}

Import-DotEnvFile 'postman-repo-sync.env'
. .\\bitbucket-repo.ps1

if ([string]::IsNullOrWhiteSpace($env:POSTMAN_REPO_SYNC_COMMIT_SHA)) {
  Write-Host 'repo-sync did not create a generated artifact commit; nothing to push.'
  exit 0
}

git cat-file -e "$($env:POSTMAN_REPO_SYNC_COMMIT_SHA)^{commit}"
Assert-NativeSuccess

$PushBranch = $env:POSTMAN_PUSH_BRANCH
if ([string]::IsNullOrWhiteSpace($PushBranch)) {
  foreach ($candidate in @($env:CHANGE_BRANCH, $env:BITBUCKET_SOURCE_BRANCH, $env:BITBUCKET_BRANCH, $env:BRANCH_NAME)) {
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      $PushBranch = $candidate
      break
    }
  }
}
if ($PushBranch -like 'refs/heads/*') {
  $PushBranch = $PushBranch.Substring('refs/heads/'.Length)
}
if (($PushBranch -like 'PR-*') -or ($PushBranch -like '*/merge')) {
  $PushBranch = ''
}
if ([string]::IsNullOrWhiteSpace($PushBranch)) {
  $PushBranch = git symbolic-ref --quiet --short HEAD 2>$null
  $PushBranch = ($PushBranch | Select-Object -First 1)
}
if ([string]::IsNullOrWhiteSpace($PushBranch)) {
  throw 'Unable to resolve a Bitbucket push branch. Set POSTMAN_PUSH_BRANCH.'
}
git check-ref-format --branch $PushBranch | Out-Null
Assert-NativeSuccess

$OriginalOriginUrl = git remote get-url origin
Assert-NativeSuccess
$AskPassPs1 = Join-Path (Get-Location).Path '.git\\bitbucket-askpass.ps1'
$AskPassCmd = Join-Path (Get-Location).Path '.git\\bitbucket-askpass.cmd'

try {
  @'
param([string]$Prompt)
if ($Prompt -like '*Username*') {
  [Console]::Out.WriteLine($env:BITBUCKET_USERNAME)
} else {
  [Console]::Out.WriteLine($env:BITBUCKET_APP_PASSWORD)
}
'@ | Set-Content -Encoding ascii -Path $AskPassPs1

  @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0bitbucket-askpass.ps1" %*
'@ | Set-Content -Encoding ascii -Path $AskPassCmd

  git remote set-url origin $env:BITBUCKET_HTTPS_REMOTE_URL
  Assert-NativeSuccess

  $env:GIT_TERMINAL_PROMPT = '0'
  $env:GIT_ASKPASS = $AskPassCmd
  $RefSpec = "$($env:POSTMAN_REPO_SYNC_COMMIT_SHA):refs/heads/$PushBranch"
  git push origin $RefSpec
  Assert-NativeSuccess
} finally {
  git remote set-url origin $OriginalOriginUrl | Out-Null
  Remove-Item -Force -ErrorAction SilentlyContinue $AskPassPs1, $AskPassCmd
}
'''
            )
          }
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'api/**/*.yaml,bitbucket-repo.env,bitbucket-repo.ps1,lint-results.json,lint-stderr.log,lint-summary.md,openapi-changes-summary.md,openapi-changes.log,postman-*.env,postman-*.ps1,postman-*-result.json,postman-service*.log,.debug/postman-smoke-flow/**', allowEmptyArchive: true
    }
  }
}
