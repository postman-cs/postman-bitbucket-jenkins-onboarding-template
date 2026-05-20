# Postman Bitbucket Jenkins Onboarding Template

Use this template to add Postman API governance, generated Postman
collections, contract tests, smoke tests, and optional generated-artifact
commits to a Bitbucket repo that runs in Jenkins.

The template is designed to be copied into an existing service repo.

## What You Get

After the pipeline is configured, Jenkins can:

1. Validate and bundle the service OpenAPI spec.
2. Run Postman Governance checks for pull requests that change API contract files.
3. Create or update the Postman workspace, API spec, and generated collections.
4. Curate the Smoke collection from the configured smoke-flow file.
5. Export generated Postman artifacts into the repo workspace.
6. Run the Contract collection against a local service instance.
7. Run the Smoke collection against the configured smoke environment.
8. Optionally commit and push generated Postman artifacts back to Bitbucket.

Generated Postman commits use a dedicated automation author. The same author
values are used by the build-loop guard, so customers can customize the Jenkins
environment values without disabling generated-commit detection.

## When It Runs

| Jenkins build type | What runs |
| --- | --- |
| Bitbucket pull request build | PR Governance only, when configured contract files changed |
| Push or merge to `main` | End-to-end onboarding flow: service dependency install, OpenAPI validation, breaking-change check, Postman onboarding/update, local Contract collection, Smoke collection, and optional generated-artifact push |
| Other branch build | No Postman flow |

For pull-request behavior, Jenkins must discover Bitbucket pull requests as
change-request builds. In that setup, Jenkins provides PR environment variables
such as `CHANGE_ID` and `CHANGE_TARGET`.

PR builds do not run service dependency install, service build commands,
Postman onboarding/update, Contract collection runs, Smoke collection runs, or
generated-artifact pushes.

## Copy Into Your Repo

Copy these paths into the target service repo:

| Path | Required | Notes |
| --- | --- | --- |
| `Jenkinsfile` | Yes | Main Jenkins pipeline |
| `.postman-ci/` | Yes | Postman onboarding configuration and pipeline support files |
| `.gitignore` entries | Yes | Merge the entries into the target repo's existing `.gitignore` |

This template does not include a service OpenAPI spec, baseline spec, shared
schema file, or Smoke flow. Add those files from the target service repo, then
point `.postman-ci/config.yaml` at the paths used by that repo.

Common service-owned inputs:

| Path | Required | Notes |
| --- | --- | --- |
| `api/openapi.yaml` | Yes, unless configured differently | Source OpenAPI spec used for validation, Governance, and Postman generation |
| `api/common-schemas.yaml` | Optional | Shared schemas referenced by the source spec |
| `baselines/openapi.yaml` | Optional | Baseline spec used for breaking-change checks |
| `.postman-api-launchpad/flows/<name>/flow.yaml` | Optional | Smoke-flow input used to curate the generated Smoke collection |

## Configure The Service Repo

Each service repo should include `.postman-ci/config.yaml`.

The included config file already has defaults. Change only the values that do
not match the target service repo.

| Field | Default | Change when |
| --- | --- | --- |
| `project.name` | `sample-api` | The Postman workspace, API spec, and collection names should use a different service name |
| `project.domain` | `sample-domain` | The service belongs to a different business or platform domain |
| `project.domainCode` | `API` | Generated Postman names should use a different short prefix |
| `project.requesterEmail` | `api-owner@example.com` | A different owner/requester should be associated with onboarding |
| `api.specPath` | `api/openapi.yaml` | The repo stores the OpenAPI source spec somewhere else |
| `api.bundledSpecPath` | `api/openapi.bundled.yaml` | The bundled OpenAPI output should be written somewhere else |
| `api.baselineSpecPath` | empty | The repo has a baseline spec for breaking-change checks |
| `api.commonSchemaPaths` | empty | The source spec references shared schema files |
| `api.contractChangePaths` | empty | Different source contract files should trigger pull-request Governance checks |
| `postman.resourcesPath` | `.postman/resources.yaml` | The Postman resource manifest should be stored somewhere else |
| `postman.smokeFlowPath` | empty | The Smoke collection should be curated from a smoke-flow file |
| `ci.installCommand` | empty | The service app needs a dependency install step before build/test |
| `ci.buildCommand` | empty | Jenkins should run a service build/test command before Postman onboarding |
| `ci.startCommand` | empty | Jenkins should start the service locally before Contract collection tests |
| `ci.localBaseUrl` | `http://localhost:3000` | The local service starts on a different URL |
| `ci.healthPath` | `/health` | The local service readiness endpoint uses a different path |
| `ci.localReadyTimeoutSeconds` | `60` | The local service needs more or less time to become ready |
| `ci.runLocalContract` | `true` | Local Contract collection tests should be disabled |
| `ci.runStageSmoke` | `false` | Smoke collection tests should be enabled for this repo |

For a spec-only repo, leave `ci.startCommand` empty. The local Contract
collection stage will skip automatically.

Keep `api.contractChangePaths` focused on source contract files, usually the
OpenAPI source spec and any shared schema files. The generated bundled spec is
used by the checks, but it does not need to trigger pull-request Governance by
itself. When `api.contractChangePaths` is empty, the pipeline uses
`api.specPath` plus any `api.commonSchemaPaths`.

Leave `api.baselineSpecPath` empty until the repo has a baseline spec. Leave
`postman.smokeFlowPath` empty until the repo has a smoke-flow file.

Do not put deployment URLs or Governance group names in `.postman-ci/config.yaml`.
Those values are configured in Jenkins so the same repo can run in different
jobs or environments without code changes.

By default, Jenkins reads `.postman-ci/config.yaml`. To use a different path,
set the Jenkins environment variable `POSTMAN_CI_CONFIG_PATH`.

## Configure Jenkins

Install or configure the following on the Jenkins controller or agent:

- Git
- Node.js and npm
- Postman CLI, or allow the pipeline to install it
- Jenkins Git and Pipeline plugins
- PowerShell for Windows agents

For Windows Jenkins agents, configure Git under
**Manage Jenkins > Tools > Git installations**:

```text
C:\Program Files\Git\cmd\git.exe
```

## Jenkins Credentials

Create these credentials in Jenkins:

| ID | Kind | Username or value | Required | Used for |
| --- | --- | --- | --- | --- |
| `postman-api-key` | Secret text | Postman API key | Yes | Postman CLI login, Governance, onboarding, generated artifact export, and collection runs |
| `postman-access-token` | Secret text | Postman access token | Yes | Governance assignment and Postman integration calls |
| `template_repo_bb_admin` | Username with password | Username: Atlassian account email. Password: Bitbucket API token | Yes for Bitbucket Cloud multibranch jobs | Bitbucket Branch Source repo discovery, PR discovery, webhook auto-registration, build status notifications, and PR Governance comments/tasks |
| `bit-bucket-app-password-template` | Username with password | Username: `x-bitbucket-api-token-auth`. Password: Bitbucket API token | Only for `commit-and-push` | Git HTTPS push of generated Postman artifact commits |
| `jenkins-bitbucket` | SSH Username with private key | Username: `git` | Optional | Checkout over SSH, if the Jenkins Bitbucket Branch Source is configured with the SSH checkout trait |

Bitbucket credentials are protocol-specific. The same Bitbucket API token value
can be stored in both Jenkins credentials, but the username must match the
operation.

| Operation | Jenkins credential | Bitbucket username | Notes |
| --- | --- | --- | --- |
| Bitbucket Branch Source repository discovery | `template_repo_bb_admin` | Atlassian account email | Used by the Bitbucket Cloud API |
| Webhook auto-registration | `template_repo_bb_admin` | Atlassian account email | Requires webhook read/write scopes |
| Pull request discovery | `template_repo_bb_admin` | Atlassian account email | Requires pull-request read scope |
| PR Governance comments and blocking tasks | `template_repo_bb_admin` | Atlassian account email | Requires pull-request write scope |
| Bitbucket build status notifications | `template_repo_bb_admin` | Atlassian account email | Requires enough repository access for commit status updates |
| Generated artifact `git push` | `bit-bucket-app-password-template` | `x-bitbucket-api-token-auth` | Used only when `POSTMAN_REPO_WRITE_MODE=commit-and-push` |
| Optional SSH checkout | `jenkins-bitbucket` | `git` | SSH keys cannot register webhooks or write PR comments |

Recommended Bitbucket API-token scopes:

| Credential | Minimum scopes |
| --- | --- |
| `template_repo_bb_admin` | Repositories: Read, Workspaces: Read, User: Read, Webhooks: Read/Write, Pull requests: Read/Write |
| `bit-bucket-app-password-template` | Repositories: Read/Write |

Do not use an Atlassian account password or SSO password. Use a scoped
Bitbucket API token. Also note that `x-token-auth` is for Bitbucket
repository/workspace access tokens; this template defaults to Bitbucket API
tokens.

## Bitbucket Checkout

For a Jenkins multibranch pipeline, configure the Bitbucket branch source with:

- server: Bitbucket Cloud
- owner/workspace: `<workspace>`
- repository: `<repository>`
- credentials: `template_repo_bb_admin`

If you want checkout over SSH, add the Bitbucket Branch Source checkout-over-SSH
trait and select `jenkins-bitbucket`. Keep `template_repo_bb_admin` configured
for Bitbucket API operations.

For generated artifact pushes, store the Git HTTPS credential as
`bit-bucket-app-password-template` and leave `BITBUCKET_CREDENTIALS_ID` set to
that value.

## Jenkins Parameters

| Parameter | Default | Purpose |
| --- | --- | --- |
| `POSTMAN_ONBOARDING_MODE` | `auto` | Choose bootstrap/update behavior |
| `POSTMAN_REPO_WRITE_MODE` | `commit-and-push` | Choose `commit-and-push`, `none`, or `commit-only` |
| `POSTMAN_PUSH_BRANCH` | empty | Optional branch override for generated artifact pushes |
| `BITBUCKET_CREDENTIALS_ID` | `bit-bucket-app-password-template` | Jenkins credential used by `commit-and-push` |
| `BITBUCKET_PR_COMMENT_AUTH_TYPE` | `username-password` | Choose `username-password` for a Bitbucket API token stored as a username/password credential, `bearer-token` for OAuth-style bearer credentials, or `none` to disable PR comments |
| `BITBUCKET_PR_COMMENT_CREDENTIALS_ID` | `template_repo_bb_admin` | Optional Jenkins credential used to write Governance summaries and tasks to Bitbucket PRs |
| `BITBUCKET_PR_CREATE_BLOCKING_TASK` | `true` | Creates or resolves a Bitbucket PR task for Governance failures |
| `POSTMAN_RUNTIME_URLS_JSON` | `{"TEST":"http://localhost:3000","STAGE":"https://stage.example.com","PROD":"https://api.example.com"}` | Environment-to-base-URL mapping |
| `POSTMAN_GOVERNANCE_GROUPS_JSON` | `{"sample-domain":"api-governance-group"}` | `project.domain` to Governance group mapping |
| `POSTMAN_CONTRACT_ENVIRONMENT` | `TEST` | Environment used for local Contract collection runs |
| `POSTMAN_SMOKE_ENVIRONMENT` | `STAGE` | Environment used for Smoke collection runs |
| `RUN_STAGE_SMOKE` | `false` | Enables or disables the Smoke collection run |

Example `POSTMAN_RUNTIME_URLS_JSON`:

```json
{
  "TEST": "http://localhost:3000",
  "STAGE": "https://stage.example.com",
  "PROD": "https://api.example.com"
}
```

Example `POSTMAN_GOVERNANCE_GROUPS_JSON`:

```json
{
  "payments": "Payments Governance",
  "orders": "Orders Governance"
}
```

The key in `POSTMAN_GOVERNANCE_GROUPS_JSON` must match `project.domain` from
`.postman-ci/config.yaml`.

PR Governance always prints a readable failure summary in the Jenkins console
and archives the full `lint-results.json`.

When `.postman/resources.yaml` contains a workspace ID from a previous
bootstrap, PR Governance lints the bundled spec with that workspace context:
`postman spec lint <bundled-spec> --workspace-id <workspace-id>`. This applies
the Governance rules available to that Postman workspace while still checking
the pull request's local spec file. If the repo has not been bootstrapped yet,
the PR check falls back to file-based Governance linting without a workspace ID.

To add the same Governance summary to Bitbucket pull requests, set
`BITBUCKET_PR_COMMENT_AUTH_TYPE` and `BITBUCKET_PR_COMMENT_CREDENTIALS_ID`.
The credential must have permission to write pull-request comments and tasks.
For Bitbucket API tokens, store the token as a Jenkins Username with password
credential, use the Atlassian account email as the username, use the API token
as the password, and select `username-password`.

The failed Jenkins build status is the primary merge blocker. If
`BITBUCKET_PR_CREATE_BLOCKING_TASK` is enabled, also enable the Bitbucket merge
check that blocks merges while pull-request tasks are open.

Environment names must use letters, numbers, and underscores only because the
pipeline exports them as Jenkins environment variables.

On the first multibranch scan, Jenkins may start one automatic build before the
parameter form is visible. The template defaults are used for that build. After
the first scan, use `Build with Parameters` to provide the target service values.

## Onboarding Modes

Use `POSTMAN_ONBOARDING_MODE=auto` for normal operation.

| Mode | Behavior |
| --- | --- |
| `auto` | Bootstrap when `.postman/resources.yaml` is missing; update when it exists |
| `bootstrap` | Create or discover Postman resources, then write `.postman/resources.yaml` |
| `update` | Require `.postman/resources.yaml` and refresh existing Postman resources |

## Generated Artifact Pushes

`POSTMAN_REPO_WRITE_MODE` controls whether generated Postman artifacts are
committed back to the repo:

| Mode | Behavior |
| --- | --- |
| `none` | Update Postman cloud assets and write generated files only inside the Jenkins workspace |
| `commit-only` | Create a local generated-artifact commit without pushing it |
| `commit-and-push` | Create the generated-artifact commit, run gates, then push it to Bitbucket |

The default is `commit-and-push`, which expects the Bitbucket write credential
to be configured. Use `none` for a dry run, or `commit-only` when you want to
inspect the generated commit without pushing it.

To prevent build loops, Jenkins checks the triggering commit once at the start
of the build and skips the main onboarding stages when that commit is a
generated artifact commit. The guard reads the same Jenkins environment values
used for generated commits and requires all of these to be true:

- commit subject matches `POSTMAN_GENERATED_ARTIFACT_COMMIT_MESSAGE`, defaulting to `chore: sync Postman artifacts and metadata`
- commit author matches `POSTMAN_CSE_AUTHOR <POSTMAN_CSE_AUTHOR_EMAIL>`, defaulting to `Postman CSE <help@postman.com>`
- changed files are only under `.postman/` and `postman/`

## First Run Checklist

1. Copy the template files into the target repo.
2. Add the service OpenAPI spec, and optional baseline or smoke-flow files.
3. Edit `.postman-ci/config.yaml` for the service paths and commands.
4. Commit and push the template files.
5. Configure Jenkins Bitbucket Branch Source with the Bitbucket API credential.
6. Add the required Postman credentials in Jenkins.
7. Set `POSTMAN_RUNTIME_URLS_JSON` and `POSTMAN_GOVERNANCE_GROUPS_JSON`.
8. Run Jenkins with `POSTMAN_ONBOARDING_MODE=auto` and `POSTMAN_REPO_WRITE_MODE=commit-and-push`.
9. Confirm `.postman/resources.yaml` and generated `postman/` artifacts are committed and pushed.
10. Use `none` for a dry run or `commit-only` to inspect generated commits without pushing.
