# Compatibility and prerequisite assessment

Initial assessment on 2026-09-23, before Office implementation. Statements below
about unexecuted local checks describe that initial assessment. Subsequent
synthetic runtime, installation and browser evidence is in
[verification](verification.md); it does not unblock the platform gates.
This records source-contract inspection, not a successful
Office integration or production certification. No Verentis file was opened or
saved through Collabora during this assessment.

## Inspected revisions

| Repository | HEAD | Working-tree qualification |
| --- | --- | --- |
| office | `a49ccce0bf3bbc1e28bd64783d0aa8174f57e794` | Initially clean; README and Apache-2.0 LICENSE only |
| platform | `0f809e6b8dd33f75f73161b02ace7f1928ef5a3e` | Clean at inspection |
| sdk | `418afb19c37607a237084b1d76018f4262a9324d` | Local package, bridge, types and header-action changes |
| apps | `da544b6947c58141c08f2a8dcffb0a1b3248c130` | Local manifest, dependency, readiness, editor and workflow changes |
| templates | `b1c7225cab5f0e1b04ed94597f3b61e590bde755` | Local manifest, dependency, readiness and documentation changes |
| cli | `64b3b5a426f905e191627dc729ce23e054d4d825` | Local manifest, packing, registry, template and test changes |
| internal-apps | `67d8991e6781de70920f35ee821dec1e4a4eb2db` | Local application-manager, dependency and deployment changes |

Related repositories are read-only for this work. Their local changes are not
released contracts, and are not attributed solely to the recorded HEAD.

## Contract/gap matrix

| Capability | Observed contract | Decision |
| --- | --- | --- |
| SDK launch | Host supplies workspace identity and file path/name/MIME/size, with optional version/ETag and entry-point context. The inspected host shape does not supply an explicit branch or stable node ID. | Do not default silently to a branch or treat a path as permanent identity. |
| Parent bridge | Ready/init handshake, token refresh, title, dirty and navigation messages exist. Host checks iframe source and app origin; sandbox flags are manifest-controlled. | Use the published SDK baseline; validate the separate Collabora child boundary independently. |
| Office caller authentication | Public access-token issuance derives audience from global configuration; its request has no app audience, installation or branch field. OAuth code flow returns identity/refresh tokens, not demonstrated Office-recipient delegated access. | Correct Office-audience issuance must be specified and verified before live session admission. Node accepting a token does not establish Office authorization. |
| Backend delegation | Node-bounded user access can renew without widening workspace/node/scopes. Trusted-service impersonation is a separate privileged path. | Useful primitive, but not an established installation- and branch-bound third-party delegation contract. Do not use shared service credentials. |
| Consent | Installation approval and OAuth registration exist. The inspected access-token mint path evaluates user grants, but does not demonstrate intersection with active installation consent. | Define and test consent enforcement across minting, renewal and uninstall. |
| Save concurrency | Upload accepts branch, checksum and idempotency metadata, but no expected version/ETag. Its head update is unconditional. | Live editing blocked. Neither WOPI locks nor read-before-write checks repair this. |
| File identity | Stable node IDs exist. Resolve-by-ID is exposed, but uses the search index. Node containment evaluates the request's branch; tokens do not bind a branch. | Need authoritative resolution and explicit branch authorization; handle rename/index lag without targeting a replacement file. |
| Session lifecycle | Access tokens normally last five minutes. Refresh rotation and bounded access renewal exist; grants are reevaluated on issuance. | Do not equate refresh with immediate revocation or browser refresh with reliable backend renewal. Define final-save and permission-loss behavior. |
| Navigation/save acknowledgement | Dirty and navigation events exist. The inspected bridge does not establish a durable-save acknowledgement or navigation veto protocol. | No claim of reliable close protection until host-consumer/browser tests demonstrate it. Never clear dirty merely because Collabora loaded or requested a save. |
| Packaging | CLI discovers `manifest.yaml` or one typed manifest at the package root. Environment overlays merge objects and replace arrays. | One canonical Office manifest; validate with a released CLI before claiming installability. No MIME claims before real acceptance evidence. |
| Deployment | Platform owns shared infrastructure and environment promotion; immutable tested artifacts are promoted without rebuilding. Existing app deployment conventions are not permission to create another live owner. | Office supplies reusable definitions only. Platform adoption requires a separately scoped change. |

## Source anchors and concrete follow-up changes

Paths below are relative to the named repositories. They identify prerequisites,
not copied implementation. Line numbers refer to the inspected working trees.

### 1. Recipient-specific, installation-bound delegation

In `platform`, under `src/2 - Security/Verentis.Security/`:

- `Verentis.Security.Application/Tokens/RequestAccessToken/RequestAccessTokenCommand.cs:10-35`
  defines the public request without audience, installation or branch binding.
- `Verentis.Security.Application/Tokens/RequestAccessToken/RequestAccessTokenCommandHandler.cs:106-179`
  implements constrained renewal and globally configured audience selection;
  `:701-785` resolves user context and emits workspace/node claims;
  `:869-978` evaluates grants and resource context.
- `Verentis.Security.Application/OIDC/GrantType.cs:7-14` and
  `Verentis.Security.Api/Controllers/OIDCController.cs:59-92` define the supported
  grants, without a demonstrated token-exchange/on-behalf-of contract.
- `Verentis.Security.Application/OIDC/ConnectToken/ConnectTokenCommandHandler.cs:197-300,395-512`
  implements code exchange and refresh rotation.
- `Verentis.Security.Application/OAuthClients/RegisterOAuthClient/RegisterOAuthClientCommandHandler.cs:84-134`
  needs examination as part of independent third-party confidential-client
  provisioning; shared internal credentials must not be handed to Office.

Propose a documented app-recipient authentication and backend-delegation flow,
preserving user identity and intersecting user rights with active installation
consent. Bind workspace, stable file, branch and permitted operations through
renewal. Specify revocation latency and session expiry explicitly. Update the
Intent model before changing generated contracts.

Required tests: wrong issuer/audience/client, expired credential, forged file,
cross-workspace/branch, scope widening on renewal, denied consent, uninstall,
permission revocation, refresh replay, and backend renewal without browser cookies.

Related consent anchors in `platform`, under
`src/6 - Extensions/Verentis.Resource/Verentis.Resource.Application/`:
`AppInstallations/ApproveAppInstallation/ApproveAppInstallationCommandHandler.cs:28-63`
and `EventHandlers/AppInstallations/AppConsentApprovedDomainEventHandler.cs:60-77`.
Documentation to align:
`src/9 - UI/developer/content/5.platform-apis/1.authentication.md` and
`src/9 - UI/developer/content/3.building-apps/5.installation-and-consent.md`.

### 2. Atomic conditional file replacement

In `platform`, under `src/5 - Node/Verentis.Node/`:

- `Verentis.Node.Api/Controllers/FilesController.cs:105-176,229-241` accepts uploads;
  the controller's existing delete `If-Match` is not an upload precondition.
- `Verentis.Node.Application/Files/UploadFileService/UploadFileServiceCommand.cs:10-40`
  has no expected-version field.
- `Verentis.Node.Application/Files/UploadFileService/UploadFileServiceCommandHandler.cs:143-149,269-275`
  reads the binding and supplies a newly generated replacement stamp.
- `Verentis.Node.Application/Paths/UpdateHeadPathBinding/UpdateHeadPathBindingCommandHandler.cs:19-27`
  performs lookup followed by unconditional head mutation.
- `Verentis.Node.Domain/Entities/Paths/PathBinding.cs:44-58` mutates the head.
- `Verentis.Node.Infrastructure/Persistence/Configurations/Paths/PathBindingConfiguration.cs:13-76`
  does not map a native ETag/concurrency token for that mutation.

Propose expected-version/ETag propagation through the public API and command,
with a persistent atomic compare-and-swap at the authoritative file head.
Coordinate blob/version publication and quota accounting so a failed comparison
cannot publish an incorrect head. Cover every relevant head writer, including
non-Office writers; do not add an Office-only lock as a substitute.

Required tests: two updates from one revision yield one success and one explicit
conflict; external update before/during Office save preserves authoritative bytes;
rename/delete/branch races cannot redirect a save; failed conditional writes do
not leak committed quota or corrupt version history. Exercise actual persistence,
not only mocked repositories.

### 3. Stable identity, branch context and host navigation

Node's `FilesController.cs:298-318` exposes `POST /v1/files/resolve`.
`Verentis.Node.Application/Files/ResolveFilesByNodeIds/ResolveFilesByNodeIdsQueryHandler.cs:28-68`
uses `Verentis.Node.Infrastructure/Search/FileSearchService.cs:141-181`.
That is an indexed lookup, not an authoritative atomic rename guarantee.
`Verentis.Node.Application/Common/Security/NodeBoundaryGuard.cs:44-88,121-159`
uses the request branch when enforcing node containment.

Propose authoritative stable-ID access/version semantics with branch restrictions,
then expose the authorized identity in the documented launch context:

- `platform/src/9 - UI/workspace/layers/files/app/lib/app-host.ts:34-73`
- `platform/src/9 - UI/workspace/layers/files/app/composables/useBridge.ts:5-43,160-187`
- `platform/src/9 - UI/workspace/layers/files/app/components/files/AppHost.vue:104-151,196-232`
- `sdk/src/types.ts`, `sdk/src/modules/context.ts` and `sdk/src/transport/bridge.transport.ts`

Required tests: rename/move and delayed indexing, replacement at an old path,
branch/workspace separation, nested iframe form submission, wrong source/origin,
host close/navigation with unsaved changes and failed/late saves. Dirty events
alone are not evidence of a working navigation guard.

### 4. Package and deployment adoption

Packaging anchors: `cli/src/vpkg/manifest.ts:215-228`,
`cli/src/vpkg/pack.ts:51-57,178-218`,
`templates/packages/application/README.md:70-76`, and
`apps/packages/smart-editor/smart-editor.app.yaml`.
`internal-apps/README.md:3-7` establishes its private operational purpose; Office
does not belong there.

Deployment adoption belongs in platform's `utilities/deployment/` and existing
`.github/workflows/deploy-sprint.yml`, `deploy-uat.yml`, `promote-demo.yml` and
`promote-production.yml`. Propose package consumption plus environment-specific
secret references, regional routing, drain gates and immutable release metadata.
No internal environment values belong in Office templates. Do not reuse
historical broad-privilege bootstrap scripts as a public deployment example.

Required tests: render all environment profiles without live deployment, enforce
one owner per resource, verify immutable image references, deny cross-region
processing configuration and demonstrate drain before promotion/rollback.

## Externally verified dependencies

### SDK

Anonymous HTTPS access to
`https://registry.npmjs.org/@verentis%2fsdk/latest` returned HTTP 200 with
`@verentis/sdk` version `0.1.1`, MIT metadata, and gitHead
`418afb19c37607a237084b1d76018f4262a9324d`.
This verifies public registry metadata availability, not yet a fresh installation
or live host compatibility. Local SDK `0.2.0` header-action changes are not the
published baseline.

### Collabora candidate

Official image candidate: `docker.io/collabora/code:26.04.4.1.1`.
Docker Hub metadata and the registry manifest agree on the index digest; the
downloaded manifest bytes were independently SHA-256 hashed:

```text
sha256:1efda3043e8b9cb437d1b6c6efe20cc3753760e634de012b8dac391da488bf97
```

Published platform manifests:

| Platform | Digest |
| --- | --- |
| linux/amd64 | `sha256:c004f998dd88c2dd7aec68b38865de9807534a28e160211136faed516fb126cc` |
| linux/arm64 | `sha256:0c433e67802a269d52cf91366471eb6a57df8ac9614db8d1334461dd30ce4710` |
| linux/ppc64le | `sha256:9c37bc20c6647b3926ac42b621c37beb1d409b78005570dadfbe966e220652dd` |

Source metadata:
`https://hub.docker.com/v2/repositories/collabora/code/tags/26.04.4.1.1`
and the official Docker registry manifest endpoint. This is a **candidate**, not
a runtime-tested or security-approved release. No image was imported or deployed.
The SDK installation documentation fetch encountered an anti-bot page; runtime
configuration must still be verified against accessible official sources and
the selected container before implementation claims.

Local toolchain observed: .NET SDK `10.0.111`, Node `24.14.0`, npm `11.12.1`.
Docker and Podman commands exist; daemon functionality was not tested. Platform
deployment projects target .NET 10 in `utilities/deployment/Directory.Build.props`.

## Scope and readiness

The current repository already supplies an Apache-2.0 license. Preserve it;
confirm owner intent before public release rather than assign a different
license. It does not license Collabora binaries, SDK code or trademarks.

Live read-only gate B, editing gate C, format/collaboration gate D and operational
gate E have **not passed**. A separately isolated synthetic-file harness can
validate Office-owned WOPI and Collabora behavior, but cannot pass these Verentis
integration gates. No manifest should claim those formats or edit modes yet.
History/secret review, fixture notices, dependency installation, image scanning,
real browser tests and owner-controlled publication approval remain outstanding.
