# Libre Office

Installer-facing listing: [Marketplace README](manifests/marketplace/README.md). Development documentation continues below.

Nuxt/Vue editor wrapper and pinned self-hosted Collabora CODE. The platform's
Collaboration service owns all WOPI admission, scoped credentials, locks and
durable saves; Office is not a file-storage or OAuth backend.

## Signed installation

`manifests/office.app.yaml` declares WOPI capabilities, supported document formats,
wrapper/operator origins and session/file limits. Local and production overlays
select their corresponding origins. Publish a signed package and approve its
exact document-processing consent candidate before opening a workspace file.
Unsigned packages produced by offline checks cannot authorize a live launch.

No Office OAuth client ID/secret, private signing key or storage credentials are
needed. Third-party WOPI applications use the same installation/launch contract.
Normal applications accessing workspace APIs continue to require normal OAuth.

### AI agent read tool

`spec.tools.read_document` (`POST /agent/read-document`) is the agent's read tool for
text documents, spreadsheets and presentations. `spec.actor` names it as the `read-tool` of a
`document` surface. The platform calls it with a token minted for the calling user
and capped to `file.read`. The wrapper downloads the saved file from the
platform (`NUXT_PLATFORM_API_URL`, default `NUXT_PUBLIC_WOPI_ORIGIN`), converts it
with CODE's `/cool/convert-to`, and returns text. It stores nothing. Writer formats
become plain text. Calc formats become tab-separated rows, under a `## <sheet>`
heading per sheet. Impress formats go through flat ODP (`fodp`, since Impress has no
text export) and become `## Slide N` sections with speaker notes. Drawings (Visio, odg)
are not readable yet. The wrapper calls CODE directly on `NUXT_CODE_URL`. CODE
accepts `convert-to` only from private addresses (`net.post_allow`) and checks every
`X-Forwarded-For` hop, so calls through the public `office-code` ingress get 403.
That relies on the ingress seeing real client IPs (`externalTrafficPolicy: Local`);
an ingress that SNATs clients to a private address would expose `convert-to`.

### AI agent live channel

`spec.actor.live-channel: agent` lets the agent act in the document the user has open,
while their tab follows the agent. The wrapper handles the `agent` host message
(`shared/agent-live.mjs`) and answers only for the open document's path; any other path
gets `not_open`. A Save As target also gets `not_open`, because its path isn't known.
- `read` sends CODE `Action_Copy` (text/plain) and returns the user's selection. With
  nothing selected it replies `use_headless`, so the platform falls back to `read_document`.
- `apply` takes up to 100 `{ op: insert_text, text }` operations (15,000 characters in
  total). Each one is sent as `Action_Paste`, which inserts it at the cursor and replaces
  any selection. Nothing is saved: the user reviews the change and saves it.
- Read-only documents refuse `apply` with `read_only`.
- While the editor is loading, reloading, renewing authorization or saving, the wrapper
  replies `not_ready`.

The wrapper never selects text or saves on the agent's behalf, so it can't read the
whole open document with its unsaved edits.

The public package identity is `verentis/libre-office`, displayed as **Libre
Office** in base, local and production packages. This is a new Marketplace
identity, not a migration of existing `verentis/office` installations. Publish,
install and approve consent for the new signed package explicitly.

## Local development

The repository is [verentis/office](https://github.com/verentis/office).
Clone it as `office` alongside `sdk` and `platform`:

```sh
git clone https://github.com/verentis/office.git
cd office
npm ci
```

The internal `@verentis/office-editor` workspace, runtime resource identities,
wrapper/CODE workload names and public DNS origins are unchanged.
Use the platform Aspire host with its documented isolated dependencies and
trusted development certificates. Office runs at `https://office.localtest.me`,
CODE at `https://office-code.localtest.me`, and WOPI callbacks target the platform
gateway. The wrapper's server uses `NUXT_COLLABORATION_URL`, not an Office backend.
Do not start multiple hosts against the same ports/resources.

Install the signed local package with consent, upload a supported document and
open it through the workspace. Direct navigation to the public wrapper is denied
without its platform-issued embed ticket. A hidden form POST transfers only the
scoped WOPI token to the trusted CODE action.

## Verification

The GitHub **Tests** workflow (`checks.yml`) checks packages, deployment
configuration, framing and the wrapper image without deployment credentials,
installing Chromium and its system dependencies before framing tests. It also
runs the shared package validation for the base manifest and every environment
overlay. The pull request workflow runs it first and delivers the preview only
when it passes; the release after the merge does not repeat it.

```sh
npx playwright install chromium --only-shell
npm run check
npm run check:framing
# With the platform warm stack already started:
npm run test:integration
npm run test:integration:operations
```

Set `VERENTIS_PLATFORM_ROOT` when the warm stack runs in a different checkout,
for example `VERENTIS_PLATFORM_ROOT=../platform.excalidraw npm run test:integration`.
Relative paths resolve from this repository, not the shell's working directory.
The selected checkout must own the ready warm environment; an invalid explicit
path fails rather than attaching to another stack. Set `VERENTIS_OFFICE_RESTART=true`
for the core scenario to verify Node/Collaboration restart before reopening.
An isolated collaboration service chain without Azure AI Search may explicitly
set `VERENTIS_OFFICE_API_UPLOAD=true`. This uploads the DOCX through the signed-in
CLI's normal workspace-scoped Node API and verifies the stored bytes before opening
real CODE; it does not claim the Search-backed directory/upload UI was exercised.

`test:integration` invokes `platform/tests/playwright`'s warm `app-office`
scenario. It must exercise real CODE open/edit/save/reopen, simultaneous sessions
and revocation against changed Collaboration services/assets. Unit tests and
mock framing checks are not end-to-end evidence. Warm resources must be rebuilt
or restarted after source, manifest or vendored SDK changes.

`check:package` validates and packs unsigned offline artifacts only; it does not
publish, install or deploy them. It inspects base/local/production archives for
the Libre Office identity and unchanged WOPI contract. The vendored SDK archive is integrity-pinned in
the lockfile. `npm run fixtures` regenerates document fixtures, not a WOPI host.

Delivery uses the shared trunk-based app workflows
([contract](https://github.com/verentis/.github/blob/main/docs/app-delivery.md)):
a pull request deploys a preview as `office-pr-<n>` / `office-code-pr-<n>` in the
internal `feature` environment and publishes a matching prerelease package; a
merge to `main` runs no tests: it builds the editor image once, deploys the same
digest directly to each production region in turn (a region succeeds when its
rollout completes), and then publishes `manifests/office.app.yaml` to the global
production registry. Publication does not install the package or grant WOPI consent.

## Layout

- `apps/editor` — trusted-parent bridge, dirty/save UX and CODE framing proxy.
- `manifests` — signed-package declarations and environment origins.
- `tests` — browser boundaries, package/deployment contracts and framing checks.
- `deploy`, `k8s` — wrapper/CODE build and workload topology.
- `apps/editor` consumes the published `@verentis/sdk` package from npm.

## Deployment

`.github/verentis-delivery.json` declares the hosted app `office`: only the
editor image (`deploy/editor.Dockerfile`) is built; CODE runs the digest pinned
in `deploy/code.lock.json`. `scripts/render-office.mjs` renders `k8s/office.yaml`
for each target from the shared deploy action's environment: every name and host
gets the preview suffix, ingresses use the platform's wildcard certificate in the
apps namespace, WOPI and the CODE allowlist name the target's `PLATFORM_ORIGIN`,
and CODE's frame policy allows the wrapper and the target's workspace hosts.
Production hosts are `office.apps.verentis.io` and `office-code.apps.verentis.io`.

Each target environment (`feature`, `production-<region>`) needs one durable
RSA private PEM as the environment secret `CODE_PROOF_KEY`. Only `pre-deploy`
receives it: it verifies the CODE pin, creates a missing `office-code-proof`
Secret in the apps namespace, preserves the same key and rejects accidental
rotation. Previews mount the same Secret read-only and never replace it. Never
generate a new key per rollout; see [operations](docs/operations.md#hosted-deployment).
The private key belongs only to CODE, not the wrapper or platform workloads.

See [architecture](docs/architecture.md), [API](docs/api.md),
[operations](docs/operations.md), [verification](docs/verification.md) and
[security](SECURITY.md). Apache-2.0 licensing is unchanged. This repository does
not independently establish successful runtime integration or deploy resources.
