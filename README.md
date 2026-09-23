# Verentis Office — live integration disabled

Nuxt/Vue/TypeScript wrapper, .NET 10 fail-closed session boundary and a **separate,
synthetic-only** Collabora CODE/WOPI harness. This is partial delivery, not a
completed Verentis integration. No real Verentis document is opened or saved.
Platform acceptance gates **B–E remain blocked**: see
[compatibility](docs/compatibility.md) and [implementation plan](docs/implementation-plan.md).

## Run isolated development

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
verification only inside the synthetic test stack.

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
and unsigned packing, deployment rendering and immutable-reference checks.
`dotnet test` covers WOPI, SQLite CAS/locks/expiry/restart and fail-closed admission.
`npm run fixtures` regenerates the six original synthetic documents.
Stop with `docker compose -f dev/compose.yaml down` (preserves the database).

## Layout

- `apps/editor` — public SDK 0.1.1 handshake and independent CODE iframe boundary.
- `services/backend` — deployable, permanently unavailable live session API.
- `services/wopi` — scoped WOPI protocol and configured discovery.
- `tests/harness`, `tests/fixtures`, `tests/protocol`, `tests/browser` — test-only state and evidence.
- `manifests` — one package root; **no MIME, permission or edit capability claims**.
- `deploy` — pinned image builds and reusable regional rendering; no deployment.
- `.github/workflows` — secret-free checks and manual, unsigned release preparation.

See [architecture](docs/architecture.md), [API](docs/api.md),
[operations/recovery](docs/operations.md), [security](SECURITY.md),
[contributing](CONTRIBUTING.md) and [third-party inventory](THIRD-PARTY-NOTICES.md).
The existing Apache-2.0 license is unchanged. No publication, import, cloud
provisioning or live deployment is authorized by this repository's plan.
