# Verification and handoff evidence

Executed locally on **2026-09-23**, Linux amd64, Node 24.14.0, .NET SDK 10.0.111,
Docker Engine 29.5.3. Baseline Office commit:
`a49ccce0bf3bbc1e28bd64783d0aa8174f57e794`.
No commit, publication, registry import, cloud provisioning or live deployment
was performed. Apache-2.0 LICENSE is unchanged.

## Passed commands

All commands run from the Office repository root:

| Command | Observed result |
| --- | --- |
| `npm ci --no-audit --no-fund && npm run check` | Clean install; Nuxt/Vue/TS type checks, 6 Node tests, two manifest profiles and deployment renders pass |
| `npm run build` | Nuxt production output built |
| `dotnet test --verbosity quiet` | 26 passed, 0 failed/skipped |
| `npm run fixtures` | Six original OOXML/ODF fixtures generated; deterministic ZIP timestamps |
| `node scripts/verify-code-lock.mjs` | Public registry index bytes independently SHA-256 hashed; all three platform digests match lock |
| `docker compose -f dev/compose.yaml up --build -d` | One real CODE, one SQLite harness, wrapper and local-TLS proxy started |
| `node scripts/wait-stack.mjs` | Wrapper, CODE discovery and WOPI harness responsive over local HTTPS |
| `npm run test:integration` | 11 real-browser tests pass; no editor mock |
| `docker build -f deploy/backend.Dockerfile -t office-backend:check .` | Deployable backend built separately from test host |
| `node scripts/check-images.mjs office-backend:check office-synthetic-editor` | Non-root image contents exclude harness/data; real backend denies live/test admission; default wrapper test API unavailable |
| `npm audit --audit-level=high` | 0 reported npm vulnerabilities at verification time |
| `dotnet list package --vulnerable --include-transitive` | No known vulnerable package reported by current NuGet sources |
| `git diff --check` | No whitespace errors; `git diff -- LICENSE` empty |

The image check references the same deployable wrapper Dockerfile used by the
isolated stack, run with its **default production configuration**, not the
synthetic environment override. No test executable is present in either
deployable image. No image-vulnerability scan or runtime production certification
is implied by package audits or source/image-content checks.

## Real CODE format results

Runtime: official CODE `26.04.4.1.1`, pinned index
`sha256:1efda3043e8b9cb437d1b6c6efe20cc3753760e634de012b8dac391da488bf97`;
Playwright 1.58.2 with Chromium 145.0.7632.6.

| Synthetic format | Discovery/editor load | Browser edit → durable content | Fresh context reopen |
| --- | --- | --- | --- |
| DOCX | PASS | Typed unique marker found in saved OOXML | PASS, after restarting **both harness and CODE** |
| ODT | PASS | Typed unique marker found in saved ODF | PASS |
| XLSX | PASS | Marker typed into A2, found in saved OOXML | PASS |
| ODS | PASS | Marker typed into A2, found in saved ODF | PASS |
| PPTX | PASS | Text box created/edited in real UI, marker found in OOXML | PASS |
| ODP | PASS | Text box created/edited in real UI, marker found in ODF | PASS |

Each file is generated from an original minimal fixture, not a customer sample.
Tests inspect SQLite-backed content through the test executable, not browser
state; a separate browser context reopens the same synthetic ID, asserts that
identity, makes another edit and saves it. The resulting bytes must contain both
the original and new markers, proving that the reopened editor retained the
earlier content rather than merely re-reading the original test-store endpoint. Only DOCX
additionally cold-restarts both services. This is basic round-trip evidence,
not format-fidelity, large-file, accessibility or collaboration certification.
Runtime on arm64/ppc64le has not been tested despite digest verification.

The five other browser cases cover denied identity/origin/format and live
admission, plus the public SDK ready/init handshake through a real local
synthetic parent, wrapper and CODE grandchild. The host token sentinel is
asserted absent from network requests; a parent-origin CODE-like message cannot
mark the child dirty. Compose logs are checked for plaintext WOPI credentials
and the host-token sentinel. Additional cases verify expiry and explicit discard
confirmation, missing save acknowledgement, and child readiness/dirty reporting
while SDK initialization is delayed. Browser traces are intentionally not captured.

## Matrix coverage

| Plan row | Passing evidence |
| --- | --- |
| Live launch | SDK browser handshake + explicit unavailable state; image smoke tests and protocol test: 503, no document/credential |
| Isolated launch | Six real discovery/edit/save/reopen/re-edit cases; invalid format/origin/identity rejected, including missing/foreign origins through the Nuxt proxy and empty upstream 404 propagation |
| WOPI access | Wrong credential, duplicate token, file/workspace/branch, expired and read-only cases deny access/mutation |
| Concurrent save | Real SQLite transactions: two sessions and two HTTP writers produce one 200/one 409; authoritative bytes retained; stale same-token requests also conflict |
| Restart/expiry | SQLite reopen preserves versions/locks/sessions; expired authorization remains denied; lock expiry never renews session; DOCX cold restart/reopen; expired UI disables saves and requires explicit confirmation to discard |
| Navigation | Genuine edits activate the dirty warning and cancel a synthetic unload event; warning survives saves; delayed handshake preserves dirty reporting; missing save response times out; host-veto limitation remains |

Review regression coverage also proves that `X-WOPI-OldLock` cannot authorize
refresh/unlock with a mismatching current lock, a stalled discovery body reaches
its 15-second deadline, inspection does not mint sessions, admission prunes
expired sessions, and omitted deployment regions fail rendering.

Raw local machine output is under ignored `artifacts/` (including
`browser-results.json`, unsigned packages and fake-digest rendering fixtures).
CI produces the same evidence artifact, but **GitHub-hosted/fork CI itself was
not executed here**. Workflow actions are commit-pinned, checkout persistence is
disabled, permissions are contents-read only, and checks require no secrets or
OIDC/cloud grants.
The manual release-preparation workflow now preserves the actual built image
archive plus checksum and source commit rather than losing images with the
runner. This workflow has not been executed on GitHub; registry publication,
import and deployment remain unavailable.

## Deliberately blocked or not certified

- Real Verentis gates **B–E remain blocked**, exactly as documented in
  [compatibility](compatibility.md). Synthetic tests replace none of them.
- No live read-only/editing, installation consent/delegation, conditional Node
  upload, stable-ID/branch routing or production credential renewal is implemented.
- No production state store, multi-replica coordination, navigation veto,
  durable-save acknowledgement, scale, regional deployment or drain certification.
- Final image scans, full history/secret review, transitive redistribution
  notices/source obligations and owner publication/legal approval remain release
  gates. CODE remains a development edition, not a support or licensing promise.
- Local CA trust and disabled CODE outbound TLS verification are synthetic-only.
  The reusable render output intentionally has no ingress and CODE is blocked.
  It is not a ready-to-deploy live installation.

All manifest MIME/capability/permission claims remain empty despite the six
synthetic successes. Release preparation is manual, unsigned and non-publishing;
OIDC/import/promotion belong to a separately authorized platform-owned workflow.
