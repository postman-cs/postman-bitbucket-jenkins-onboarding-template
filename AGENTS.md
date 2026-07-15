# postman-bitbucket-jenkins-onboarding-template

Bitbucket + Jenkins CI template for Postman API governance, generated collections, contract/smoke tests, optional generated-artifact commits. Template designed to be copied into existing service repo.

## What You Get

After pipeline configured, Jenkins can:
1. Validate + bundle service OpenAPI spec
2. Run Postman Governance + OpenAPI breaking-change checks for PRs changing API contract files
3. Create/update Postman workspace, API spec, generated collections
4. Curate Smoke collection from configured smoke-flow file
5. Export generated Postman artifacts into repo workspace
6. Run Contract collection against local service instance
7. Run Smoke collection against configured smoke environment
8. Optionally commit/push generated Postman artifacts back to Bitbucket

Generated Postman commits use dedicated automation author. Same author values used by build-loop guard, so customers can customize Jenkins environment values w/o disabling generated-commit detection.

## When It Runs

| Jenkins build type | What runs |
| --- | --- |
| Bitbucket PR build | PR Governance + breaking-change checks only, when configured contract files changed |
| Push/merge to `main` | End-to-end onboarding: dep install, OpenAPI validation, breaking-change check, Postman onboarding/update, local Contract collection, Smoke collection, optional generated-artifact push |
| Other branch build | No Postman flow |

For PR behavior, Jenkins must discover Bitbucket PRs as change-request builds. Jenkins provides PR env vars like `CHANGE_ID`, `CHANGE_TARGET`.

PR builds do not run dep install, service build, Postman onboarding/update, Contract runs, Smoke runs, or generated-artifact pushes.

## Copy Into Your Repo

Copy these paths into target service repo:

| Path | Required | Notes |
| --- | --- | --- |
| `Jenkinsfile` | Yes | Main Jenkins pipeline |
| `.postman-ci/` | Yes | Postman onboarding config + pipeline support files |
| `.gitignore` entries | Yes | Merge entries into target repo's existing `.gitignore` |

Template does not include service OpenAPI spec, baseline spec, shared schema file, or Smoke flow. Add those files from target service repo, then point `.postman-ci/config.yaml` at paths used by that repo.

## Configure The Service Repo

Each service repo should include `.postman-ci/config.yaml`. Included config file already has defaults. Change only values that don't match target service repo.

Key fields: `project.name`, `project.domain`, `project.domainCode`, `project.requesterEmail`, `api.specPath`, `api.bundledSpecPath`, `api.baselineSpecPath`, `api.commonSchemaPaths`, `api.contractChangePaths`, `postman.resourcesPath`, `postman.smokeFlowPath`, `governance.breakingChangeMode`, `governance.breakingRulesPath`, `governance.prReviewMentionEmail`, `ci.installCommand`, `ci.buildCommand`, `ci.startCommand`, `ci.localBaseUrl`, `ci.healthPath`, `ci.localReadyTimeoutSeconds`, `ci.runLocalContract`, `ci.runStageSmoke`.

Do not put deployment URLs or Governance group names in `.postman-ci/config.yaml`. Those values configured in Jenkins so same repo can run in different jobs/environments w/o code changes.

By default, Jenkins reads `.postman-ci/config.yaml`. To use different path, set Jenkins env var `POSTMAN_CI_CONFIG_PATH`.

## Configure Jenkins

Install/configure on Jenkins controller or agent:
- Git
- Node.js + npm
- Postman CLI, or allow pipeline to install it
- `tar`, outbound HTTPS access to GitHub releases so pipeline can install pinned `openapi-changes` binary
- Jenkins Git + Pipeline plugins
- PowerShell for Windows agents

For Windows Jenkins agents, configure Git under **Manage Jenkins > Tools > Git installations**: `C:\Program Files\Git\cmd\git.exe`

## Jenkins Credentials

Create these credentials in Jenkins:

| ID | Kind | Required | Used for |
| --- | --- | --- | --- |
| `postman-api-key` | Secret text | Yes | Postman CLI login, Governance, onboarding, generated artifact export, collection runs |
| `postman-access-token` | Secret text | Yes | Governance assignment + Postman integration calls |
| `template_repo_bb_admin` | Username w/ password | Yes for Bitbucket Cloud multibranch jobs | Bitbucket Branch Source repo discovery, PR discovery, webhook auto-registration, build status notifications, PR Governance comments/tasks |
| `bit-bucket-app-password-template` | Username w/ password | Only for `commit-and-push` | Git HTTPS push of generated Postman artifact commits |
| `jenkins-bitbucket` | SSH Username w/ private key | Optional | Checkout over SSH |

Recommended Bitbucket API-token scopes:
- `template_repo_bb_admin`: Repositories: Read, Workspaces: Read, User: Read, Webhooks: Read/Write, Pull requests: Read/Write
- `bit-bucket-app-password-template`: Repositories: Read/Write

Do not use Atlassian account password or SSO password. Use scoped Bitbucket API token.

## Bitbucket Checkout

For Jenkins multibranch pipeline, configure Bitbucket branch source w/:
- server: Bitbucket Cloud
- owner/workspace: `<workspace>`
- repository: `<repository>`
- credentials: `template_repo_bb_admin`

If checkout over SSH, add Bitbucket Branch Source checkout-over-SSH trait + select `jenkins-bitbucket`. Keep `template_repo_bb_admin` configured for Bitbucket API operations.

For generated artifact pushes, store Git HTTPS credential as `bit-bucket-app-password-template`, leave `BITBUCKET_CREDENTIALS_ID` set to that value.

## Jenkins Parameters

Key parameters: `POSTMAN_ONBOARDING_MODE` (default `auto`), `POSTMAN_REPO_WRITE_MODE` (default `commit-and-push`), `POSTMAN_PUSH_BRANCH`, `BITBUCKET_CREDENTIALS_ID`, `BITBUCKET_PR_COMMENT_AUTH_TYPE`, `BITBUCKET_PR_COMMENT_CREDENTIALS_ID`, `BITBUCKET_PR_CREATE_BLOCKING_TASK`, `POSTMAN_RUNTIME_URLS_JSON`, `POSTMAN_GOVERNANCE_GROUPS_JSON`, `POSTMAN_WORKSPACE_LINK_ENABLED`, `POSTMAN_ENVIRONMENT_SYNC_ENABLED`, `POSTMAN_SYSTEM_ENV_MAP_JSON`, `POSTMAN_CONTRACT_ENVIRONMENT`, `POSTMAN_SMOKE_ENVIRONMENT`, `RUN_STAGE_SMOKE`.

## Onboarding Modes

Use `POSTMAN_ONBOARDING_MODE=auto` for normal operation.

| Mode | Behavior |
| --- | --- |
| `auto` | Bootstrap when resources manifest missing; update when exists |
| `bootstrap` | Create/discover Postman resources, then write resources manifest |
| `update` | Require resources manifest + refresh existing Postman resources |

## Generated Artifact Pushes

`POSTMAN_REPO_WRITE_MODE` controls whether generated Postman artifacts committed back to repo:

| Mode | Behavior |
| --- | --- |
| `none` | Update Postman cloud assets + write generated files only inside Jenkins workspace |
| `commit-only` | Create local generated-artifact commit w/o pushing |
| `commit-and-push` | Create generated-artifact commit, run gates, then push to Bitbucket |

Default = `commit-and-push`, expects Bitbucket write credential configured. Use `none` for dry run, `commit-only` to inspect generated commits w/o pushing.

To prevent build loops, Jenkins checks triggering commit once at build start + skips main onboarding stages when that commit = generated artifact commit. Guard reads same Jenkins environment values used for generated commits + requires all:
- commit subject matches `POSTMAN_GENERATED_ARTIFACT_COMMIT_MESSAGE`, defaulting to `chore: sync Postman artifacts and metadata`
- commit author matches `POSTMAN_CSE_AUTHOR <POSTMAN_CSE_AUTHOR_EMAIL>`, defaulting to `Postman CSE <help@postman.com>`
- changed files only under generated artifact directories

## First Run Checklist

1. Copy template files into target repo
2. Add service OpenAPI spec, optional baseline or smoke-flow files
3. Edit `.postman-ci/config.yaml` for service paths + commands
4. Commit + push template files
5. Configure Jenkins Bitbucket Branch Source w/ Bitbucket API credential
6. Add required Postman credentials in Jenkins
7. Set `POSTMAN_RUNTIME_URLS_JSON` + `POSTMAN_GOVERNANCE_GROUPS_JSON`
8. Run Jenkins w/ `POSTMAN_ONBOARDING_MODE=auto` + `POSTMAN_REPO_WRITE_MODE=commit-and-push`
9. Confirm resources manifest + generated `postman/` artifacts committed + pushed
10. Use `none` for dry run or `commit-only` to inspect generated commits w/o pushing

## Commands

No build/test commands. Template = static files copied into service repos.

## Anti-Patterns

- Never hardcode secrets, tokens, or absolute paths in durable memory
- Never use Atlassian account password or SSO password for Bitbucket API token
- Never put deployment URLs or Governance group names in `.postman-ci/config.yaml`
