# Verification and handoff evidence

## Current local Playwright acceptance and parked handoff - 2026-10-08

The user requested bounded Office regression verification and then parking this
showcase work. The rebuilt current wrapper's framing-proxy integration check
passes, as do all seven Chromium browser boundary scenarios. The missing local
Chromium executable was restored into the directory configured by
`playwright.config.ts`; no browser security setting or test deadline was relaxed.
These checks use synthetic upstream resources and do not prove live CODE saves.

Both real installed journeys now pass sequentially against the owned
`platform.excalidraw-security` slot-9 warm runtime and real Collabora CODE:

| Journey | Current result |
| --- | --- |
| `app-office` | All seven outcomes pass: signed install/pre-install consent, ordinary DOCX upload and byte verification, real CODE launch, durable edit/save, distinct-user bidirectional coauthoring, fresh-browser reopen with exact persisted markers, and revocation/new-launch denial |
| `app-office-operations` | All six outcomes pass: signed operations consent, source edit/save, real CODE rename with stable WOPI identity, Save As, exact derived-target continuation, and target-only subsequent persistence with the source unchanged |

An earlier attempt failed before CODE opened: Marketplace's POST
`/v1/installations/graphs` returned 500 because its
`AppInstallationConsentClient.RecordEditorPreConsentAsync` call to Resource's
PUT `/v1/app-installations/editor-pre-consents` returned 403. Resource runtime
logs corroborate both denials. The request forwards the interactive caller;
Resource's pre-consent handler requires a normal workspace-bound administrator
token through `HostedInstallationAdministrator` / `InstallationAuthorization`.
The graph approval client omitted the required `workspace.write`
scope; the correction below resolved that failure without changing Resource
authorization. A subsequent upload failure exposed the CLI's obsolete
`workspaceId` token selector. The CLI now uses Security's generalized `resourceId`
target, restoring normal workspace-bound upload authority without changing Node
ingress/egress. Its 53 focused refresh, registry and development-loop tests pass,
along with the previously verified CLI typecheck/build.

Current scenario-local reports, screenshots and sanitized status attachments are
under `tests/playwright/scenarios/app-office/outcomes/` and
`tests/playwright/scenarios/app-office-operations/outcomes/` in the platform
feature worktree. Credential-bearing traces/videos remain disabled; raw private
diagnostic logs are not release artifacts. To rerun, use an explicit
platform checkout, not the wrapper script's default shared `../platform` checkout:

```bash
cd <platform checkout>/tests/playwright
VERENTIS_HARNESS_NATIVE_ACCEPTANCE=true VERENTIS_OFFICE_API_UPLOAD=true npm run test:warm -- app-office --project=chromium
VERENTIS_HARNESS_NATIVE_ACCEPTANCE=true VERENTIS_OFFICE_API_UPLOAD=true npm run test:warm -- app-office-operations --project=chromium
```

Start and verify an owned isolated warm environment before these commands.
The API upload option uses the ordinary authenticated CLI Node upload/download
pipeline without substituting Search or authorization. The native acceptance CLI
uses the configured local CA and explicitly enables TLS certificate verification,
even when emulator setup has disabled it in the parent process.

Revocation coverage uses the supported public Resource administrator API, not
the obsolete Marketplace management selector. An independent browser context
approves the ordinary CLI device sign-in. The helper resolves exactly one package
under the expected publisher and exactly one active Resource installation bound
to that package/workspace, revokes that identity, verifies its persisted `Revoked`
status, and retains all active-session/dirty-state/Save/new-launch denial checks.
It does not force an app update to expose the management panel. This proves
revocation behavior, **not Marketplace revocation UI coverage**.

Current local Office basics and both complete browser journeys are verified.
These runs used unchanged standalone Security source at
`b400a63f1480ed038c50737ef58034922209b5dc`, built with the supported script as
`aryzac/security-service:excalidraw-b400a63f1480`, and the integrity-pinned DD1 SDK
archive. This is exact-source local acceptance, not published-registry digest
acceptance or deployed-version testing. Optional Node/Collaboration restart was
not enabled in these final runs; historical restart evidence below is separate.
This work is parked, not
release-ready; broader scaling/performance, native restart/revocation and
compatible SDK publication are deferred. No merge or deployment is claimed.

The owned warm supervisor and tracked AppHost descendants were shut down after
retaining the evidence. The isolated gateway port 51500 is closed and no warm
session remains; no shared runtime or other agent's worktree was stopped.

### Consent-journey correction and residual risk - 2026-10-08

The Office install helper already follows the current wizard's Editor step and
approves consent before installation. A source-level caller-scope mismatch was
found instead: `useInstallationGraphs.approve` requested
`installation.write` but omitted `workspace.write`, which
`HostedInstallationAdministrator` requires when recording editor pre-consent.
Approval now requests that additional scope only when the signed graph preview
contains editors; ordinary app/dependency installations retain their existing
scopes. No Resource authorization rule or ordinary Node file path changed.

The Marketplace browser fixture now encodes requested scopes and workspace
binding in a synthetic fixture-only token, and its mocked approval endpoint
rejects editor consent without both administrator scopes. A new denial scenario
requires a visible error, cleared consent and no false installed state.
All four wizard Playwright scenarios and 32 focused Marketplace unit checks pass;
the new unit regression failed on the old scope request before the correction.
Evidence is scenario-local under
`tests/playwright/scenarios/install-wizard/outcomes/`. Marketplace typecheck
remains blocked by existing errors in `StatsChart.vue` and shared
`brand/Supergraphic.vue`, outside the consent change.

The real Office journeys above also use this pre-install consent flow; there is
no separate post-install WOPI approval in their installation helper.

One earlier operations run genuinely failed Save As during derived admission
with EF Cosmos `DbUpdateConcurrencyException`. CODE reported `storage/savefailed`,
and no derived continuation receipt became available. The final operations run
passed all six outcomes after an owned Collaboration restart, but no persistence
race correction is claimed: the intermittent failure remains a follow-up risk.
Credential-safe WOPI failure diagnostics now include conflicting entity type
names only, never entity values, exception data or credential-bearing scopes;
all five focused telemetry tests and the actual Collaboration API build pass.
If the failure recurs, identify the stale entity before changing admission or
fencing. Do not relax authority checks, repeat the copy blindly or modify
ordinary Node upload/download to make the scenario pass.

## Shared platform-facing lifecycle - 2026-10-04

The wrapper now consumes SDK-owned exact-origin/window validation, host-document
binding and durable generation/correlation receipt checks. CODE URL/format checks,
message translation and internal coauthoring remain provider-specific.
The wrapper now consumes integrity-pinned published package
`@verentis/sdk@0.2.5`. Older archive names below identify historical verification
inputs only and are not current dependencies.

Local checks passed: Nuxt typecheck, all 36 Office unit checks, base/local/production
package validation and offline packing, deployment rendering, and the built
Chromium framing-proxy integration test. The rebuilt current wrapper also passes
all seven browser boundary scenarios, including durable save, Save As continuation,
revocation, wrong-target denial and target expiry. These are boundary and compatibility
checks, not a newly executed real CODE warm journey, cloud deployment, Microsoft
Office integration, or Software Factory completion.

### Installed local CODE journey - partial acceptance

The journeys below used the previous platform feature runtime. Consumer alignment
is now isolated in `platform.excalidraw-security` on
`feat/excalidraw-security-alignment`, merged with the current `sprint-10` baseline.
Use the authoritative standalone Security image from the platform's
`utilities/deployment/security/SECURITY_IMAGE`, not the historical `0e07b48` image.
That alignment preserves AuthZEN live
authorization, SSF permission invalidation and explicit installation drainage.
These historical CODE results do not establish interoperability with the pinned
standalone image; current exact-source local acceptance is recorded above.

The owned isolated platform profile has now executed the real `app-office`
scenario, using signed Marketplace installation, administrative document-processing
consent and ordinary CLI-authenticated Node upload. The uploaded DOCX was verified
byte-for-byte through the authenticated Node API. The workspace's metadata-only
projection opened the known file without an emulated Search service.

The latest run passed outcomes 1-6: installation/consent, upload, real CODE launch,
a confirmed save checkpoint, distinct-user bidirectional coauthoring with a
confirmed coauthor save, and fresh-browser reopen after restarting Node and
Collaboration. The restart helper required healthy new process identities for
both services. An ordinary authenticated Node download also contained all three
exact edit markers in the persisted DOCX. The underlying AppHost, storage and
CODE operator were not restarted.

This run used the normal Office integration wrapper against a genuinely verified
owned-attachment supervisor. Fresh authenticated publication and CODE discovery
checks established attachment readiness; installation and document-processing
consent still occurred through the scenario's ordinary UI/API journey.

Outcome 7 failed because the administrator's public Resource installation-revocation
request returned HTTP 503 instead of 200. Successful revocation, active-session
drainage and denial of a subsequent launch therefore remain unverified.

The failure was traced to the private installation-revocation request omitting
the installation's account binding. The native drain rejects an empty account
scope, producing an internal HTTP 500 and public HTTP 503. The source correction
now carries the persisted, verified Marketplace account ID from Resource through
Collaboration into both native drainage and WOPI fencing. Missing or empty
bindings remain fail-closed with the durable admission freeze retained; the
authenticated internal endpoint rejects incomplete scope before invoking drainage.
Focused transport, HTTP authorization and actual native-guard orchestration
regressions pass. The corrected services still require a real installed revocation
rerun; this is not yet live revocation acceptance.

An earlier run failed during coauthoring with
**"Document cannot be saved, please check your permissions."** and unavailable live
save status/authorization. That failure did not recur in the latest run, but its
root cause has not been established. The harness does not dismiss that denial or
force clicks through the modal. Subsequent runs persist bounded
operation/method/HTTP-status/timestamp/actor diagnostics without credential-bearing
URLs, identifiers, headers or bodies.

Evidence remains in the platform scenario's own `app-office/outcomes/` directory,
with trace and video disabled. The restart run is preserved under
`app-office/outcomes/core-restart-reopen-resource503/`. Revocation acceptance
remains incomplete. An earlier non-restart run
also encountered a transient HTTP 500 on fresh launch; its subsequent relaunch
before revocation failed, so that run did not exercise revocation.
Search-backed directory UI is explicitly outside this isolated-profile run.

The matching supervised `app-office-operations` run passed all six outcomes:
signed operations consent, a confirmed source save, CODE-driven rename with
stable WOPI identity, real Save As, exact server-selected target continuation,
and subsequent target-only persistence. Continuation retained the same CODE
iframe and browser document without another launch or document-form submission.
Authenticated Node downloads contained all three markers in the target DOCX;
the source contained its original marker but neither later target marker.

The successful run and sanitized transport/message/control categories are
preserved under
`app-office-operations/outcomes/supervised-saveas-target-persistence-pass/`.
An earlier run returned `storage / savefailed` with derived receipt polls at
204. That failure did not recur in the latest supervised run, but its root cause
has not been established; this success does not prove every intermittent
backend failure is resolved.

## Platform-owned cutover — 2026-09-27

The historical evidence below describes the removed Office-owned WOPI/synthetic
architecture and **does not validate the platform-owned cutover**.

Verified after removing all Office backend/WOPI source and project files:

| Command / scope | Observed result |
| --- | --- |
| SDK `npm test && npm run typecheck && npm run build` | 84 tests passed; types and ESM/CJS/declaration builds passed |
| Workspace app-host, registry, WOPI bridge and continuation tests; `npm run typecheck` | 32 tests passed; typecheck passed |
| Office `npm run check` | Typecheck, 23 unit tests, local/production manifest validation and unsigned packaging, deployment rendering and 5 deployment tests passed |
| Office `npm run check:framing` | Production wrapper build and 1 built HTTP framing integration test passed |
| Office `npm run test:browser-boundaries` | 7 Chromium tests passed: nested-ancestor CSP, save receipt gating, nonsecret Save As/continuation, revoked submission, failure recovery, wrong-target rejection and target expiry |
| Office and SDK `git diff --check` | Passed |

The framing tests use mock upstream authorization/editor resources; they prove
wrapper boundaries, not real CODE editing. The browser maps the actual nested
Collaboration response, uses only explicit approved WOPI installation selection,
and preserves exact generation/correlation receipts across later coauthor writes.

Real warm `app-office` open/edit/save/reopen/coauthor/revoke execution remains
required against changed Collaboration and hosting assets. No live runtime
success, deployment, or Software Factory verification is claimed here.

### Save-confirmation diagnostic — 2026-09-27 15:49 warm trace

The real CODE trace contains `Received Host_PostmessageReady.` and the wrapper's
save acknowledgement. All 41 authenticated status responses were `ready` with
`receipt: null`; all three successful checkpoint requests recorded generation 1.
The wrapper therefore correctly withheld durable confirmation.

The pinned CODE source accepts the current `Action_Save` flags and forwards
`ExtendedData` through its save command:
[Map.WOPI.js](https://github.com/CollaboraOnline/online.mirror/blob/825c9caa93da8651971522ba82a80fa0777539c0/browser/src/map/handler/Map.WOPI.js#L695-L703).
The focused built-wrapper Chromium regression requires that handshake and wire
shape, then proves CODE acknowledgement plus `Modified=false` cannot clear dirty
until a matching platform receipt arrives. Ordinary save and Save As tests both
passed; all 9 boundary unit tests passed. These tests use mock CODE/platform
resources and do not claim live persistence success. No runtime production
code or confirmation security rule was changed for this diagnostic.

### Save As HTML interaction

The wrapper now handles trusted CODE `UI_SaveAs` with an accessible HTML filename
form. Local checks passed: 11 boundary unit tests, Nuxt typecheck and production
build, and the 7 Chromium boundary tests above. The browser tests exercise the
built wrapper against mock CODE/platform resources, including spoof rejection,
cancel without a command, invalid path rejection, exact `Filename`/`Notify`
fields, revoked submission, failed-operation recovery, and retained edits while
waiting for authoritative continuation. They do not claim real CODE acceptance.

The separate platform `app-office-operations` scenario uses the actual HTML form;
its 4 local contract checks, harness typecheck and test discovery passed.
The parent owns loading the updated wrapper and running the warm scenario after
the core/restart scenario finishes. No warm execution or service restart was
performed for this UI change.

### Nonsecret continuation across signing-key rotation

Workspace now adopts `/derived`'s exact persisted target control IDs directly.
The SDK returns only document metadata and target `accessTokenTtl`; no public
target launch or token reconstruction occurs. Office retains the initial form
and CODE iframe/token while separately updating active document metadata.

Verified locally: SDK 84 tests/typecheck/build; workspace admission/continuation
21 tests and typecheck; Office 16 boundary/configuration tests, typecheck/build
and 7 Chromium tests. The recovery-denial mock now succeeds without touching a
reconstruction callback. Malformed, expired, credential-bearing and wrong-scope
continuations fail closed; Chromium verifies the target deadline independently
of the retained source launch and preserves later edits through rebinding.
The historical verification used `verentis-sdk-0.2.0-b72fdeb675b6.tgz`; the
current dependency is the published `@verentis/sdk@0.2.6` package.

These are local boundary checks, not a new real-key-rotation or warm acceptance
claim. The parent owns the backend expiry DTO field and warm execution.

### Real Save As readiness diagnosis — 2026-09-27

Authorized `app-office-operations` runs on warm coordinator `1743304` reproduced
a post-rename reload race: CODE received the correct trusted `Action_SaveAs`
while `_appLoaded` was false and sent no `saveas` socket command. The wrapper now
tracks `Frame_Ready`, permits filename entry while loading, and gates dispatch
on CODE's supported `Get_Views_Resp` readiness response.

The final real run passed outcomes 1-4. At `2026-09-27T18:26:15.728Z`, CODE received
`Action_SaveAs` with the expected filename, `Notify=true`, `_appLoaded=true` and
`UserCanNotWriteRelative=false`; its actual `saveas` socket command followed at
`18:26:15.729Z`. CODE then reported `storage / savefailed` from `18:26:28.677Z`.
All observed authenticated `/derived` responses remained 204. Outcomes 5-6
therefore remain unverified pending the parent's storage investigation.

Sanitized evidence is in the scenario's `office-operation-categories.json`;
the pre-fix summary is `outcomes/save-as-readiness-before.json`. No trace/video,
credentials, full messages or token-bearing URLs were recorded. No backend or
stack configuration was changed, and no services were restarted.

## Historical evidence (superseded architecture)

Executed locally on **2026-09-23**, Linux amd64, Node 24.14.0, .NET SDK 10.0.111,
Docker Engine 29.5.3. Baseline Office commit:
`a49ccce0bf3bbc1e28bd64783d0aa8174f57e794`.
No commit, publication, registry import, cloud provisioning or live deployment
was performed. Apache-2.0 LICENSE is unchanged.

## Local Aspire follow-up (2026-09-23)

Office baseline `52cf80b464bee96437a71d17b0936adc3e1e645a`; platform baseline
`0f809e6b8dd33f75f73161b02ace7f1928ef5a3e`. Existing unrelated platform Execution
changes were left untouched.

Commands below were actually executed. Platform commands are relative to its
repository; Office commands are relative to Office unless stated otherwise.

| Command | Observed result |
| --- | --- |
| `scripts/setup-certs.sh --export-ca-only` (platform) | Exported existing public mkcert CA; no trust installation or leaf regeneration |
| `dotnet test utilities/deployment/Verentis.Deployment.Tests --filter 'FullyQualifiedName~LocalFrontendRouting\|FullyQualifiedName~LocalOffice' --nologo -v quiet` (platform) | 41 passed, 0 failed/skipped: exact routes, sibling path, run/publish/test models, image lock, missing prerequisites, hostname/server-EKU checks, wrong CA and safe public-only export |
| `dotnet build "src/0 - Aspire/Verentis.AppHost" --no-restore --nologo -v quiet` (platform) | Passed, 0 errors; existing warnings include platform AutoMapper 14.0.0 advisory NU1903 and nullable warnings |
| `dotnet build utilities/local-office --nologo -v quiet` (platform) | Passed, 0 warnings/errors |
| `npm run check` | Types, 8 Node tests, released CLI validation/packing of local/compose/production overlays and deployment checks passed |
| `dotnet test --nologo -v quiet` | 26 protocol tests passed |
| `TMPDIR="$PWD/office/artifacts/aspire" dotnet run --no-build --project platform/utilities/local-office` (workspace root, after creating the artifact directory) | Actual Aspire-owned Nuxt, CODE, harness and shared TLS YARP started and became responsive; only Office-focused resources started by this command |
| `curl --noproxy '*' --cacert platform/scripts/.certs/rootCA.pem https://office.localtest.me/_ready` (workspace root) | Trusted HTTPS 200, `{"status":"ready"}` |
| `NODE_EXTRA_CA_CERTS="$PWD/../platform/scripts/.certs/rootCA.pem" npm run test:aspire` | 2 passed: trusted browser HTTPS, discovery, real WSS, DOCX edit/save, fresh context reopen/re-edit preserving both markers, denied live admission/foreign origins; runtime log assertions passed |
| `docker compose -f dev/compose.yaml up --build -d && node scripts/wait-stack.mjs` | Existing standalone localhost stack rebuilt and became responsive |
| `npm run test:integration -- --grep 'docx: real CODE\|harness rejects'` | 2 passed, including durable DOCX save and fresh reopen after restarting both Compose harness and CODE |
| `git diff --check` (both repositories) | Passed |

Runtime Docker inspection additionally confirmed the locked CODE digest, strict
`ssl.ssl_verification=true`, configured OpenSSL trust and a single read-only mount
containing **only the public CA**. The gateway's network alias resolves callbacks
inside Aspire's Docker network; an unknown hostname returned 404 in the focused
host. Browser tests did not use `ignoreHTTPSErrors` or certificate-error flags.
During implementation, the browser test correctly failed when the outbound
OpenSSL trust file was omitted; explicit OpenSSL and storage CA configuration
fixed the callback handshake without weakening verification.
Final review also found plaintext synthetic WOPI tokens in YARP informational
proxy logs. Office registration now raises both ASP.NET and YARP logging to
Warning. A restarted focused host passed the browser suite's new checks of
gateway, CODE and WOPI stdout/stderr, with no credential-bearing URLs. No
credential values are included in this evidence document.

This is end-to-end evidence for the **focused Aspire host using the same
registration helper**, not a claim that the full platform was started or that
source-string tests prove runtime behavior. The normal AppHost compiled and its
registration/routing is regression-tested. Full-platform startup was deliberately
not launched to avoid affecting unrelated services. The existing six-format
Compose suite above is historical evidence; this change reran the targeted DOCX
and admission cases, not every format. Aspire and Compose validation resources
were stopped afterwards; named synthetic state volumes were preserved.
Raw Aspire browser results are in ignored `artifacts/aspire/browser-results.json`.
No system/browser CA trust was changed, and live integration remains blocked.

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
