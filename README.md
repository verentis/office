# Verentis Office — local development preview

Nuxt/Vue wrapper and .NET 10 WOPI backend connecting real Verentis files to
self-hosted Collabora CODE. The local preview uses installation-bound backend
delegation and conditional platform saves. It registers 56 CODE-supported file
extensions; view-only formats remain read-only. See
[live setup, supported formats and limitations](docs/live-local-setup.md).
Production package manifests remain disabled pending production acceptance.
The separate sprint AKS workload deployment is documented in
[operations](docs/operations.md#sprint-aks-deployment).
The standalone synthetic harness is separate from the live Aspire integration.

## Run with local Aspire

Check out `office` beside `platform`, then run `npm ci` in Office. Set up the
platform's shared mkcert certificate using `platform/scripts/setup-certs.sh`
(this explicitly installs local CA trust). If the trusted leaf/key already exist,
`platform/scripts/setup-certs.sh --export-ca-only` exports only the public root
without changing system/browser trust.

Normal platform startup starts the Office Nuxt dev server, live WOPI backend
and digest-pinned CODE automatically:

```sh
# From platform/
dotnet run --project "src/0 - Aspire/Verentis.AppHost"
```

Open a supported file in its authenticated workspace after installation,
consent and backend pairing. The wrapper runs at **https://office.localtest.me**;
editor and callbacks use
`https://office-code.localtest.me` and `https://office-wopi.localtest.me`.
All three use the shared wildcard certificate; CODE verifies callback TLS.
Missing checkout, image lock or certificate files fail startup with setup guidance.
Publish and `ASPIRE_TEST_MODE` exclude Office resources. See the
[setup guide](docs/live-local-setup.md) for the local preview manifest and
independent backend credential.

To validate Office without starting unrelated platform services, use
`dotnet run --project utilities/local-office` from platform instead. Do not run
both hosts together: they share port 443 and the live coordination directory.
The focused host still needs a running platform API and backend configuration.
See [operations](docs/operations.md) for topology and verification commands.

## Run standalone Compose development

Prerequisites: Node 24, npm, .NET 10, Docker Engine with Compose, Python 3 for
fixture generation/content assertions. No cloud credentials are needed.

```sh
npm ci
npm run check
dotnet test
docker compose -f dev/compose.yaml up --build -d
node scripts/wait-stack.mjs
```

Visit **https://office.localhost:8443** in a dedicated local browser profile.
Trust the development CA as described in [operations](docs/operations.md).
Open an original fixture, edit, request save, then reopen its synthetic ID in a
new tab to confirm persistence. Nothing is persisted to Verentis.

**Do not expose this stack, put real documents in it, or use its test identity
as authentication.** It binds loopback, uses local TLS and relaxes certificate
verification only inside the legacy standalone Compose stack, not Aspire.
Use the `compose` manifest overlay for this URL; `local` now targets Aspire.

## Verify real browser round trips

```sh
mkdir -p artifacts
PLAYWRIGHT_BROWSERS_PATH="$PWD/artifacts/browsers" TMPDIR="$PWD/artifacts" npx playwright install chromium
npm run test:integration
```

On supported Linux CI, add `--with-deps` to install browser OS dependencies.
Tests use the real pinned CODE container, not a document-editor mock. Each
DOCX/ODT/XLSX/ODS/PPTX/ODP test types a marker, checks the durable synthetic ZIP
content, and freshly reopens it for a second edit/save that must preserve the
first marker. Results: `artifacts/browser-results.json`;
the handoff summary records passed/blocked cases separately.
See the checked-in [verification evidence](docs/verification.md) for exact
commands, per-format results and remaining release gates.
Browser traces are disabled to avoid capturing session credentials.

`npm run check` runs types, boundary unit tests, released CLI 0.2.18 validation
and unsigned packing, deployment rendering and immutable-reference checks,
including the offline sprint workload contract.
`dotnet test` covers WOPI, SQLite CAS/locks/expiry/restart and fail-closed admission.
`npm run fixtures` regenerates the six original synthetic documents.
Stop with `docker compose -f dev/compose.yaml down` (preserves the database).

## Layout

- `apps/editor` — pinned local SDK bridge, borderless editor and independent CODE iframe boundary.
- `services/backend` — installation-bound live sessions and durable conditional-save coordination.
- `services/wopi` — scoped WOPI protocol and configured discovery.
- `tests/harness`, `tests/fixtures`, `tests/protocol`, `tests/browser` — test-only state and evidence.
- `manifests` — one package root; the local overlay enables supported formats, while production stays gated.
- `deploy` — pinned image builds and reusable regional rendering.
- `k8s` — sprint-only live workload template; no marketplace package publication.
- `.github/workflows` — secret-free checks, manual unsigned release preparation,
  and an OIDC-authenticated `feat/**`-push sprint AKS deployment using a protected
  GitHub environment (not UAT/production).

See [architecture](docs/architecture.md), [API](docs/api.md),
[operations/recovery](docs/operations.md), [security](SECURITY.md),
[contributing](CONTRIBUTING.md) and [third-party inventory](THIRD-PARTY-NOTICES.md).
The existing Apache-2.0 license is unchanged. This repository does not provision
cloud identities, permissions, secrets or storage, and does not publish packages.
Do not deploy until the Platform embed/host registry contract, the Office-specific
backend credentials and persistent state, and the sprint rollout prerequisites
described in operations have been approved.
