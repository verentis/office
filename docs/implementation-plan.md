---
title: Verentis Office prerequisite-gated implementation
type: feature
created: 2026-09-23
status: done
baseline_commit: a49ccce0bf3bbc1e28bd64783d0aa8174f57e794
review_loop_iteration: 0
context:
  - docs/compatibility.md
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** Office needs a supported-API-only Collabora integration. Current
platform contracts do not establish safe backend delegation and lack atomic
conditional uploads, so neither live read-only nor editing can be certified.

**Approach:** Build the Office-owned slice: Nuxt wrapper, fail-closed .NET session
boundary, real Collabora/WOPI synthetic-file harness, packaging and deployment
preparation. Keep live sessions disabled until platform gates pass. This is
partial delivery, not a completed Verentis integration.

## Boundaries & Constraints

**Always:** Change only `office`. Use Nuxt/Vue/TS, .NET 10, public SDK 0.1.1,
digest-pinned CODE and Compose. Exclude the test host from deployable images.
Preserve Apache-2.0 LICENSE; inventory upstream rights separately.

**Ask First:** Expand scope, provision, publish/import, change visibility/license
or deploy. This plan authorizes no cloud operations.

**Never:** Internal credentials, Verentis tokens sent to Collabora, direct storage,
browser autosaves, invented delegation, unsafe writes, untested MIME claims,
production in-memory coordination, commits or false completion claims.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Expected behavior | Error handling |
| --- | --- | --- | --- |
| Live launch | SDK file context, prerequisites missing | Prompt handshake; explicit unavailable state; no WOPI token or file transfer | Actionable blocker, never fake success |
| Isolated launch | Synthetic fixture and test-only identity | Configured discovery action; scoped WOPI credential; real nested editor | Reject unknown format, URL, origin or identity |
| WOPI access | Wrong file/workspace/branch, expired credential, read-only write | Deny without content or mutation | Protocol-appropriate failure |
| Concurrent save | Test file changed since admitted revision | Atomic conflict; retain authoritative file and dirty state | Recovery instructions; no silent overwrite |
| Restart/expiry | Backend restart, lock/session expiration | Durable harness state; expired authorization remains denied | Reopen/recovery state, never invented renewal |
| Navigation | Untrusted child message or unacknowledged save | Ignore untrusted messages; no false saved indication | Explicit host-guard limitation |

</frozen-after-approval>

## Code Map

- `docs/compatibility.md` contains exact revisions, source anchors and prerequisite
  tests. Node upload lacks CAS; Security issuance lacks the required delegation;
  host bridge guard behavior remains unproved. All sibling sources are read-only.
- CLI discovers one manifest at package root; use `manifests/` as that root.

## Tasks & Acceptance

**Execution:**
- [x] `apps/editor/` -- SDK handshake, distinct parent/child checks, truthful
  loading/error/dirty states, constrained launch form; live admission disabled.
- [x] `services/wopi/` -- fail-closed admission; CheckFileInfo/GetFile/PutFile,
  lock/refresh/unlock, configured discovery, scoped credentials, bounded streaming
  and redacted logs. Advertise only implemented capabilities.
- [x] `tests/harness/`, `tests/fixtures/` -- separate synthetic-file executable;
  SQLite transactional sessions/locks/versions, one backend and one CODE instance.
  No production state-store or multi-replica claims.
- [x] `tests/` -- matrix coverage, protocol/concurrency/restart tests and real CODE
  browser round trips for synthetic DOCX/ODT/XLSX/ODS/PPTX/ODP; report each result.
- [x] `dev/compose.yaml`, `dev/.env.example` -- one-command isolated stack, local
  TLS, container/browser addressing and explicit synthetic-only warning.
- [x] `manifests/office.app.yaml`, `manifests/environments/` -- one validated
  package with no untested MIME claims and visible disabled-integration status.
- [x] `deploy/` -- verified CODE lock, wrapper/backend images and render-tested
  reusable definitions; immutable references, regional input, no test host.
- [x] `.github/workflows/` -- secret-free PR checks and controlled build/import
  preparation; immutable actions, least privilege/OIDC, no live deployment.
- [x] `README.md`, `docs/`, `CONTRIBUTING.md`, `SECURITY.md`,
  `THIRD-PARTY-NOTICES.md` -- setup, ADR, APIs, configuration, operations,
  drain/recovery, licensing, public-readiness and blocked acceptance gates.

**Acceptance Criteria:**
- Given current platform contracts, when live admission is requested, then no
  document or credential reaches Collabora.
- Given the isolated stack, when DOCX is edited and freshly reopened, then edits
  persist in the test store, explicitly not Verentis.
- Given competing writers, when both save one revision, then only one wins and
  the other conflicts without overwriting the winner.
- Given deployable images, when inspected, then no test host or auth bypass exists.
- Given fork CI, when checks run, then no production secrets or deployment powers
  are required.
- Given handoff evidence, when reviewed, then exact commands and passed/blocked
  cases are distinct; real Verentis gates B-E are not replaced by harness tests.

## Spec Change Log

Review corrections: preserve empty upstream errors; reject omitted regions;
bound discovery body reads; restrict old-lock replacement to LOCK; inspect
synthetic files without minting sessions and prune expired sessions on admission.
Track successful SDK initialization independently, keep expiry persistent, require
explicit discard on failed/expired launch reset, and time out unacknowledged saves.
Strengthen fresh-reopen, dirty-state, proxy-origin and lifecycle acceptance.
Retain built image archives during release preparation. Approved intent unchanged.

## Design Notes

SQLite provides transactional harness state, not a second user-facing store.
No live adapter targets speculative APIs. Platform repairs remain separately scoped.

## Verification

Executed on 2026-09-23; detailed commands, matrix mapping and limitations are in
[verification evidence](verification.md).

- `npm ci --no-audit --no-fund && npm run check` -- passed: type checking,
  six boundary/configuration tests, released CLI 0.2.18 validation/unsigned
  packing for both overlays and deployment checks.
- `dotnet test --verbosity quiet` -- 26 passed; protocol, SQLite persistence,
  isolation, same-revision conflicts, bounded streaming and expiry/restart.
- `docker compose -f dev/compose.yaml up --build -d` and
  `node scripts/wait-stack.mjs` -- real isolated TLS stack started and responsive.
- `npm run test:integration` -- eleven passed: real edit/save/fresh reopen/re-edit for
  DOCX/ODT/XLSX/ODS/PPTX/ODP, invalid admission and nested SDK/CODE boundaries.
  DOCX also passed after restarting the harness and CODE. Log redaction checked.
- `node scripts/verify-code-lock.mjs` -- registry manifest bytes and platform
  digests verified.
- `node scripts/check-images.mjs office-backend:check office-synthetic-editor`
  -- built deployable images exclude test host/data, run non-root and deny
  live/test admission as designed.
- `npm audit --audit-level=high` and
  `dotnet list package --vulnerable --include-transitive` -- no known package
  vulnerabilities reported by the current sources.

No GitHub-hosted CI, final-image security scan, publication/import or live
deployment was performed. OIDC/import/promotion integration remains a separately
authorized platform adoption step. Real Verentis gates B–E remain blocked;
synthetic successes do not change MIME claims or integration status.

## Suggested Review Order

**Fail-closed integration boundary**

- Start with the explicit unsupported live-session contract.
  [`LiveAdmission.cs:1`](../services/wopi/LiveAdmission.cs#L1)
- Distinguish platform prerequisites from successful synthetic evidence.
  [`compatibility.md:1`](compatibility.md#L1)

**Editor and callback boundaries**

- Follow source/origin validation, handshake readiness, expiry and conservative dirty handling.
  [`app.vue:1`](../apps/editor/app/app.vue#L1)
- Inspect scoped WOPI operations and bounded content handling.
  [`WopiEndpoints.cs:1`](../services/wopi/WopiEndpoints.cs#L1)
- Review transactional test-only locks, sessions and revision checks.
  [`SyntheticStore.cs:1`](../tests/harness/SyntheticStore.cs#L1)

**Acceptance and packaging**

- Check two-stage persistence assertions and real browser lifecycle coverage.
  [`roundtrip.spec.ts:1`](../tests/browser/roundtrip.spec.ts#L1)
- Review secret-free checks and retained immutable release artifacts.
  [`checks.yml:1`](../.github/workflows/checks.yml#L1)
  [`prepare-release.yml:1`](../.github/workflows/prepare-release.yml#L1)
- Read exact passed commands and remaining limitations.
  [`verification.md:1`](verification.md#L1)
