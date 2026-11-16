# Configuration and operations

## Topology

Libre Office deploys only the Nuxt wrapper and digest-pinned CODE. Platform
Collaboration owns the WOPI host, discovery/proofs, persisted session/lock/receipt
state, workload authentication and Node persistence. Remove old Office backend
targets rather than maintaining two authorities.

| Public surface | Owner |
| --- | --- |
| Office wrapper | Nuxt; platform-issued embed ticket required |
| CODE `/browser/**` | Wrapper framing proxy to CODE |
| CODE WebSockets and other editor routes | CODE |
| `/wopi/files/**` | Platform Collaboration, scoped WOPI authentication |
| `/v1/collaboration/**` | Platform Collaboration launch/session/framing API |

The wrapper explicitly returns 404 for its retired `/api` namespace, including
old test/session endpoints, rather than serving Nuxt's SPA fallback with 200.
This does not change CODE framing authorization or platform API routing.

Normal platform APIs retain their normal OAuth middleware. WOPI routes must not
be accidentally gated by platform JWT authentication or expose internal
Security/Resource/Node authority endpoints.

## Browser asset caching

The wrapper marks successful static assets beneath CODE's hexadecimal,
content-versioned `/browser/{version}/` path as public and immutable for one
year. This allows browsers and the proxied Cloudflare zone to reuse bundles
until a CODE upgrade changes the version segment.

Document HTML, query-bearing or non-versioned paths, credentialed requests,
cookie-setting responses, upstream cache prohibitions and failures remain
`no-store`. After deployment, confirm a versioned asset progresses from
`CF-Cache-Status: MISS` to `HIT`; do not add a cache rule that includes
`cool.html` or WOPI-bearing URLs.

## Wrapper configuration

| Setting | Meaning |
| --- | --- |
| `NUXT_COLLABORATION_URL` | Trusted Collaboration server base for framing authorization |
| `NUXT_CODE_URL` | Trusted internal CODE HTTP endpoint |
| `NUXT_PUBLIC_WRAPPER_ORIGIN` | Exact HTTPS wrapper origin |
| `NUXT_PUBLIC_EDITOR_ORIGIN` | Exact HTTPS CODE browser/proxy origin |
| `NUXT_PUBLIC_WOPI_ORIGIN` | Exact HTTPS platform gateway origin |
| `NUXT_HTTPS_CERT`, `NUXT_HTTPS_KEY` | Optional paired local development TLS files |

There is no Office client ID/secret, private signing key, SQLite volume,
credential store, test identity or synthetic-mode switch. CODE allowlists and
TLS trust must reference the platform WOPI origin, not the removed Office WOPI
hostname. CODE mounts only the public development CA, never a CA private key.
Do not disable TLS verification or weaken filesystem permissions to fix local
environment failures.

The wrapper denies framing by default. Platform-approved navigation adds only
the exact workspace ancestor and injects that origin into its initial browser
handshake. CODE document POSTs require platform scope authorization before the
proxy substitutes exact wrapper/workspace ancestors; other CSP directives remain.

## Startup and verification

Use the platform AppHost or its focused Office host according to the platform
runbook; do not run both against the same ports/resources. A green `/_ready`
only proves the wrapper process responds. It does not prove consent, live
admission, CODE discovery, callback proofs or durable saves.

Run the real platform warm `app-office` scenario after rebuilding/restarting
changed services, manifests and SDK assets. Use isolated dependencies and test
documents. Never silently fall back to production Search/storage or stale
Office backend binaries. Framing unit/integration tests use substitute upstreams
and are not runtime acceptance evidence.

## Recovery and rollout

### Bounded storage-request budget

All Office deployment renderers and the platform local host set
`net.connection_timeout_secs=120`. CODE applies this to the complete outgoing
storage request. Save As includes live authorization, native copy persistence,
and target admission; the stock 30-second limit can discard a successful
platform response after that work commits.

The 120-second budget is bounded and does not extend credentials, renew consent,
or bypass current permission checks. Collaboration's Node clients separately
default to 30 seconds per composed call; individual Security and Resource
admission calls retain their five-second deadlines.

Preserve the pinned image's native `--use-env-vars` startup support when using
`extra_params`. The XML default alone does not show the effective command-line
override. Load updated startup configuration at a coordinated safe point;
`SIGHUP` terminates this CODE build rather than reloading its configuration.
Never treat a gateway-side HTTP 200 or a committed copy as proof that CODE
received the response and switched to the target document.

### CODE diagnostic logging and WOPI credentials

The pinned CODE URL anonymizer preserves query parameters, including WOPI
`access_token` values. `logging.anonymize.anonymize_user_data=true` is therefore
not a token-redaction control. Until CODE provides reliable URI credential
redaction, local Aspire, Compose and Kubernetes disable its unsafe diagnostics:

- Normal and startup levels are `none`; both client-settable verbosity bounds
  are also `none`, including the separate `verbose`/`terse` override paths.
- Browser/protocol logging, main/UI-command file logging and replay tracing are
  disabled. The admin console is disabled to prevent its independent runtime
  log-level override. LOKit logging is suppressed with `SAL_LOG=-INFO-WARN` and
  the matching `logging.lokit_sal_log` configuration.
- Do not inject `COOL_LOGFILE`, `COOL_LOGFILE_UICMD`, `COOL_TRACE_STARTUP`, or
  conflicting later command-line logging overrides. In particular, setting a
  presence-tested file-log variable to the string `false` does not disable it.

This deliberately sacrifices CODE diagnostic logs and its admin console, not
editor error messages. Use platform WOPI operation/status diagnostics, durable
receipts, HTTP status, health checks and browser-visible failures. Those platform
diagnostics must remain credential-safe; do not log complete callback URLs or
request bodies. This policy covers CODE's supported loggers, not a guarantee
about arbitrary native crash output.

Source references for the pinned commit:
[logging options](https://github.com/CollaboraOnline/online.mirror/blob/825c9caa93da8651971522ba82a80fa0777539c0/coolwsd.xml.in#L116-L124),
[query-preserving anonymizer](https://github.com/CollaboraOnline/online.mirror/blob/825c9caa93da8651971522ba82a80fa0777539c0/common/Anonymizer.hpp#L204-L214),
and [client overrides](https://github.com/CollaboraOnline/online.mirror/blob/825c9caa93da8651971522ba82a80fa0777539c0/wsd/ClientSession.cpp#L1351-L1395).

The change takes effect only after loading the rebuilt AppHost model and
recreating `office-code`, or rendering/applying the updated deployment
environment. Restarting a container with its old environment does not apply it.
Coordinate this with active sessions; do not restart during an owned warm run.
After reload, reproduce a failing callback and inspect log-token matches only as
counts in a trusted process, never printing matched values. Existing logs may
already contain live credentials: restrict access and handle retention/removal
through the operator's incident procedure rather than assuming this update
sanitizes old logs.

### Session recovery

Preserve Collaboration/Node durable state through restarts. Treat an unresolved
save as unknown until a correlated durable receipt or fresh authoritative reopen
proves it. CODE acknowledgements, browser state and readiness alone cannot prove
persistence. Expired or revoked sessions require current platform admission;
do not create a bypass or force an overwrite.

Drain active sessions before changing operator origins or pinned CODE versions.
Material signed-package changes require renewed consent. Promote immutable
reviewed wrapper/CODE artifacts only after live evidence; this code change does
not publish packages or deploy workloads.

## Hosted deployment

The hosting-owned workload template and delivery configuration cover wrapper and
CODE only, using the platform gateway for callbacks. Platform deployment owns
Collaboration database, messaging, workload credentials and durable signing
material. No Office-specific OAuth secret or old Office WOPI service is required.
The repository is `verentis/office`; the `office-editor` image/workload,
`office-code` workload and `office-code-proof` Secret keep their names. Platform
remains the sole WOPI authority.

Delivery follows the shared trunk-based app contract
(`verentis/.github` `docs/app-delivery.md`). `pull-request.yml` and `release.yml`
first run `checks.yml` (unit, package, deploy-render, framing and image checks
plus shared package validation); nothing is built, deployed or published unless
it passes. `.github/verentis-delivery.json` declares the hosted app `office`:

| Setting | Value |
| --- | --- |
| Image | `verentis/office-editor` from `deploy/editor.Dockerfile` (the only image built; CODE uses the pinned upstream digest) |
| Render | `node scripts/render-office.mjs` (no npm dependencies) |
| Pre-deploy | `verify-code-lock.mjs`, then `provision-code-proof.mjs "$NAMESPACE"`, then `check-prerequisites.mjs "$NAMESPACE"` |
| Secrets | `CODE_PROOF_KEY`, exported to pre-deploy and render only |
| Deployments | `office-code`, `office-editor` (plus the preview suffix) |
| Health | `https://office<suffix>.<apps domain>/_ready`, `https://office-code<suffix>.<apps domain>/hosting/discovery` |

The renderer reads the deploy action's `IMAGE HOST APP_NAME HOST_SUFFIX
APPS_DOMAIN NAMESPACE TLS_SECRET PLATFORM_ORIGIN` and fails closed unless:
the image is `…/verentis/office-editor@sha256:…`; `APP_NAME` is `office` plus
the suffix and `HOST` is `APP_NAME.APPS_DOMAIN`; `APPS_DOMAIN` is
`apps.<platform root>`; and `PLATFORM_ORIGIN` is an exact lowercase HTTPS origin
(no credentials, port, path, trailing slash, query or fragment) under that root.
Every workload, service and ingress name and selector carries the suffix, so
previews never collide with the stable copy. Ingresses use the platform's
wildcard certificate (`TLS_SECRET`) in the apps namespace; there is no per-app
certificate or cluster-scoped object.

`PLATFORM_ORIGIN` sets wrapper callbacks and CODE's `:443` WOPI allowlist. CODE's
static frame policy allows the wrapper origin and the target's workspace hosts
(`https://*.<platform root>`, for example `https://*.verentis.io`); the wrapper's
`/browser` proxy narrows it per request to the wrapper and the exact embedding
parent. Known looseness: the wildcard also matches other apps' hosts
(`*.apps.<platform root>`) and does not cover verified custom workspace domains;
CODE pages outside `/browser` therefore remain frameable by any platform-root host.
Production hosts are `office.apps.verentis.io` and
`office-code.apps.verentis.io`; the feature overlay takes its hosts from publish
parameters.

### Proof-key provisioning

Each target environment (`feature` and every `production-<region>`) must have a
durable GitHub environment secret named `CODE_PROOF_KEY`. It contains the
**complete RSA private PEM**, not a random password, public key, fingerprint, or
base64-encoded PEM. Generate it once through the approved custody procedure
(the `proof-key.mjs` helper produces 3072-bit RSA), retain approved backups, and
reuse that key on every rollout. Use a separate key for each environment.
Upload it via stdin, without placing private material in arguments:

```bash
umask 077
node scripts/proof-key.mjs init artifacts/code-proof/proof_key
gh secret set CODE_PROOF_KEY --repo verentis/office --env <environment> \
  < artifacts/code-proof/proof_key
```

Protect the custody file and backups; do not commit or include them in logs.
Delivery never regenerates keys and never writes the key to a runner file,
render artifact, package, Docker build context or image. A missing secret fails
the deploy.

`pre-deploy` runs `node scripts/provision-code-proof.mjs "$NAMESPACE"` in the
target apps namespace. The helper validates unencrypted RSA private-key material
before cluster access, then:

- Reads `office-code-proof` privately; malformed or unreadable existing data
  fails closed without replacement.
- Preserves an identical RSA key, including equivalent PKCS#1/PKCS#8 encodings.
- Rejects a different key with an explicit drained-rotation error.
- Creates a missing Secret with a Kubernetes JSON document sent to `kubectl`
  through stdin. It never passes private material in command arguments or
  echoes the document, key, or raw subprocess errors.
- Re-reads after creation, including an `AlreadyExists` race, and accepts only
  the intended key. It never uses apply/patch to overwrite an existing key.

The helper removes `CODE_PROOF_KEY` from the `kubectl` child environment and
captures its output privately. The delivery identity needs Secret get/create in
the apps namespace. The Secret is created outside the rendered manifests, so it
carries no preview label: closing a pull request never removes it, and previews
in the same namespace mount the stable copy's key read-only.

Changing the GitHub secret alone is **not** rotation: deployment will reject
the mismatch. Pause deployments, drain sessions and coordinate GitHub custody,
the Kubernetes Secret and CODE's restart using the explicit rotation procedure
below. Verify public discovery and real signed callbacks before resuming.

`scripts/check-prerequisites.mjs "$NAMESPACE"` then requires a nonempty
`proof_key` in `office-code-proof` and no `office-wopi`
deployment/service/ingress; a cluster read failure aborts deployment. It reads
Secret metadata/byte counts, not private-key values, and only namespaced
resources. A nonempty Secret is not proof of RSA validity or working callback
signatures: verify those through discovery and signed callbacks after rollout.

Only wrapper and CODE manifests are applied, retaining strict TLS verification,
proof isolation, credential-safe logging and the 120-second CODE storage budget.
CODE uses a `Recreate` strategy: a CODE digest or pod-configuration change
interrupts active edits in each region it reaches. The private key belongs only
to CODE, **not** the Nuxt wrapper or any platform workload; Platform
Collaboration consumes CODE's public discovery proof keys and retains separate
WOPI token-signing material.

The signed package is `verentis/libre-office` / **Libre Office**. Existing
`verentis/office` installations are not automatically migrated; publish/install
the new identity and approve its exact consent candidate. The harness scenario
IDs (`office`, `app-office`) and checkout/host paths remain unchanged.

## CODE proof-key custody

The operator provisions a persistent RSA proof key with
`node scripts/proof-key.mjs init <operator-key-path>`. Initialization preserves
an existing key; the command prints only its public-key fingerprint. Rotation
uses `rotate <operator-key-path> --drained` **after** active CODE sessions have
been drained. Protect the retained previous key as private material too.

The pinned image starts `/usr/bin/coolwsd` directly as `cool` (UID/GID 1001);
it has no `/bin/sh` or legacy startup script. Keep its native entrypoint and
place the private key at `/etc/coolwsd/proof_key` with access restricted to CODE.
Local Aspire uses its container-file copy API to set UID/GID 1001 and mode 0400,
without changing the source file. Do not mount it
into the browser wrapper, put it in a signed package, or confuse it with
Collaboration's separate WOPI token-signing material.

A bounded probe of the pinned image verified native startup, discovery publication
of the supplied key, identical current/old discovery moduli, and preservation of
the configured external HTTPS action origin. Actual callback proof-signing,
drained rotation and complete editor behavior still require warm-runtime checks.
Source configuration alone does not verify them. See the platform deployment
[secrets strategy](../../platform/utilities/deployment/docs/secrets-strategy.md).

### Current hosting contract

Local Aspire persists one CODE proof key per frontend port at
`artifacts/code-proof/slot-<frontend-port>/proof_key` in the Office checkout,
with mode 0600. It is independent of the platform's per-slot WOPI token-signing
keys. The API gateway listens on `6500 + slot offset`; wrapper/CODE origins use
`443 + slot offset`. CODE's exact allowlist targets the API gateway, while its
`server_name` preserves the public CODE hostname and slot port in discovery.
The focused `platform/utilities/local-office` host requires an already-running
platform; it is not a replacement WOPI service.

The following are **manual operator deployment commands**, not part of local
checks. Normal delivery uses the durable GitHub secret and provisioning helper above;
direct Kubernetes commands are for explicitly coordinated custody/rotation.
From the Office repository, initially provision the independent CODE key:

```bash
umask 077
node scripts/proof-key.mjs init artifacts/code-proof/proof_key
kubectl create secret generic office-code-proof --namespace <apps-namespace> \
  --from-file=proof_key=artifacts/code-proof/proof_key \
  --dry-run=client -o yaml | kubectl apply -f -
```

Keep the source file and its backups in approved secret custody; never commit
them. The Kubernetes template projects only `proof_key` into CODE, read-only
mode 0440, at `/etc/coolwsd/proof_key` using a subPath mount and pod fsGroup 1001.
CODE runs as UID/GID 1001 without a shell or root startup phase; neither the wrapper nor
Collaboration mounts the private key. Namespace Secret RBAC and encryption at
rest remain operator responsibilities.

Standalone Compose bind mounts retain host ownership: the operator-managed
`proofKeyFile` must be owned by UID 1001 and mode 0400 before startup. Provision a
separate deployment copy using the host's approved administrative procedure,
for example `install -o 1001 -g 1001 -m 0400 <custody-source> <deployment-path>`.
Do not make the source or deployment copy world-readable. Compose does not
implement ownership remapping for file-backed secrets.

After pausing deployment and verifying active sessions are drained, rotate,
update the matching GitHub environment secret from the same custody file
(using `gh secret set ... < file` as above), and reapply the Kubernetes Secret:

```bash
node scripts/proof-key.mjs rotate artifacts/code-proof/proof_key --drained
kubectl create secret generic office-code-proof --namespace <apps-namespace> \
  --from-file=proof_key=artifacts/code-proof/proof_key \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout restart deployment/office-code --namespace <apps-namespace>
kubectl rollout status deployment/office-code --namespace <apps-namespace>
```

Previews in the same namespace (`office-code-pr-<n>`) mount the same Secret;
restart them too, or close their pull requests, before admitting sessions.

The helper retains the previous private file as `proof_key.old-<unique-id>`.
Do not assume the pinned CODE build supports separately configured current and
old proof private keys. A drained restart, expiry of Collaboration's discovery
cache, and verification of the new discovery public key and real signed
callbacks are required before admitting sessions again. Do not treat rollout
readiness as proof verification. Rotate Collaboration's token-signing keys
separately using its current/previous public-key configuration.

Keep HTTP query/body and verbose proxy telemetry disabled for credential-bearing
routes. Never include access tokens, form bodies, private
keys or document content in traces/screenshots/support logs.
