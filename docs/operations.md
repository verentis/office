# Configuration and operations

## Local Aspire

Normal platform run mode registers `app-office`, `office-wopi` and `office-code`.
Office must be a sibling of `platform`; install its npm dependencies with
`npm ci`. Platform's `scripts/setup-certs.sh` generates the wildcard leaf/key
and exports **only** mkcert's public `rootCA.pem` into `scripts/.certs`.
For an existing trusted certificate, `scripts/setup-certs.sh --export-ca-only`
does not install mkcert, regenerate a certificate or change CA trust.
The AppHost checks the leaf/key pair, Office DNS names and chain to the public
CA, and rejects missing/invalid prerequisites before registering Office.
Never copy `rootCA-key.pem` into this directory or any container.
Export rejects an existing leaf that is expired, unsuitable for server TLS or
signed by another CA, without replacing the previous public CA export. Restore
the original `CAROOT` if it changed. To deliberately replace an expired or wrong
leaf with one signed by the currently trusted mkcert CA, stop the local host,
back up the existing leaf/key if needed, then run from `platform/`:

```sh
mkcert -cert-file scripts/.certs/localtest.me.pem -key-file scripts/.certs/localtest.me-key.pem localtest.me '*.localtest.me' localhost 127.0.0.1 ::1
scripts/setup-certs.sh --export-ca-only
```

This does not install trust for a different CA; that remains an explicit owner
action through the normal certificate setup.

| Browser origin | Shared frontend gateway destination |
| --- | --- |
| `https://office.localtest.me` | HTTPS Nuxt dev server, dynamic Aspire port |
| `https://office-code.localtest.me` | CODE HTTP port 9980; HTTPS/WSS terminates at gateway |
| `https://office-wopi.localtest.me` | Live .NET backend, dynamic Aspire HTTP port |

These are exact host routes at order 0, ahead of the workspace wildcard at 100.
The original Host is preserved. The gateway has the Aspire container-network
alias `office-wopi.localtest.me` and listens internally on 443, so CODE does
**not** resolve callbacks to its own loopback or depend on host-gateway forwarding.
CODE mounts only the public CA file read-only and uses
`ssl.ssl_verification=true`, explicit `ssl.ca_file_path` / `storage.ssl.ca_file_path`
and OpenSSL `SSL_CERT_FILE` pointing at `/etc/ssl/certs/office-rootCA.pem`.
No CA private key or leaf private key is mounted into CODE. The Office wrapper
requires a one-use platform embed ticket on navigation and emits an exact
workspace `frame-ancestors` policy. CODE document HTML travels through the
Office server, which checks the WOPI session and replaces only its
`frame-ancestors` directive with the exact workspace and Office origins.
CODE WebSockets and non-browser routes remain directly served by CODE. There
is no per-workspace host list and no wildcard framing policy.

The backend retrieves discovery through CODE's trusted HTTPS origin. Nuxt uses
the backend endpoint directly. CODE discovery → backend health → Nuxt `/_ready` determines
startup readiness. The gateway references routes without waiting on callback
dependencies, avoiding a startup cycle. Live SQLite recovery state and protected
credentials reside in `artifacts/live-data`, with a persistent key ring under
`keys/`. Preserve both across restarts; never delete them to resolve a conflict.
See [live setup and recovery](live-local-setup.md).

The normal platform gateway's existing certificate policy on private Nuxt
upstreams is unchanged; browser ingress and CODE callback verification are
separate, trusted TLS paths. Keep the local preview private. Publish and
`ASPIRE_TEST_MODE` do not add Office resources or require its checkout/certificates.
An unconfigured backend rejects live admission.
Office registration suppresses ASP.NET request and YARP informational proxy
logging on the shared local gateway because WOPI credentials occur in URLs.
The Aspire browser suite checks gateway/CODE/harness output for plaintext
credential URLs; do not re-enable verbose proxy logs during document sessions.

For focused hosting without starting/stopping unrelated services:

```sh
# From platform/, with port 443 free and the shared certificate ready
dotnet run --project utilities/local-office
```

The focused host links the same Office registration used by the normal AppHost,
not a reimplementation. Its dashboard uses `https://localhost:18890`.
The browser must already trust the mkcert CA; the Aspire test does not disable
TLS validation, install trust or accept arbitrary self-signed certificates.
It requires a running platform API, independent backend configuration and an
authorized workspace. The older `test:aspire` browser suite targets the previous
synthetic resource topology; it is not a live-preview acceptance suite.
Do not run focused and full hosts together. Ctrl+C stops only resources owned
by that host.
Linux machines missing browser libraries need the Playwright `--with-deps`
installation option. Live acceptance requires the sibling platform checkout and preconfigured browser
CA trust; standalone Office CI does not establish live platform acceptance.
`/_ready` is process readiness, not ongoing document-save health. CODE and WOPI
have their own Aspire health checks; successful document saves are established by
the browser acceptance suite, not a green readiness endpoint.

## Standalone Compose development

`docker compose -f dev/compose.yaml up --build -d` starts one CODE, one harness,
one wrapper and a Caddy local-TLS reverse proxy. Only `127.0.0.1:8443` is published.
`node scripts/wait-stack.mjs` waits for all three HTTPS services.
Use the `compose` manifest overlay (`--env compose`); `local` targets Aspire.

| Browser origin | Container route |
| --- | --- |
| `https://office.localhost:8443` | proxy → editor:3000 |
| `https://code.localhost:8443` | proxy → code:9980 |
| `https://wopi.localhost:8443` | proxy → harness:8080 |
| `https://host.localhost:8443` | static synthetic SDK contract host; not Verentis |

The proxy has matching Docker DNS aliases so CODE reaches the same WOPISrc the
browser sees. Discovery uses private `http://code:9980/hosting/discovery`; CODE
advertises the configured public TLS origin. The pinned CODE image's
`net.content_security_policy` explicitly admits the wrapper and synthetic parent
host as frame ancestors. Browser tests exercise this three-origin nesting.
`home_mode.enable=true` suppresses CODE welcome popups for this isolated harness;
its upstream limits (20 connections / 10 documents) are not production capacity.
Do not guess configuration across versions.

Caddy creates a local CA in the `tls` volume. For manual browsing, extract and
trust **only this development CA** in a dedicated browser profile:

```sh
mkdir -p artifacts
docker compose -f dev/compose.yaml cp proxy:/data/caddy/pki/authorities/local/root.crt artifacts/office-local-ca.crt
```

Do not install a CA automatically or copy its private key. The automated browser
accepts this local certificate; the isolated CODE disables outbound certificate
verification explicitly. **Neither setting belongs in a real deployment.**
If `.localhost` resolution is unsupported by your browser, map these three
names to loopback using your normal local development DNS configuration.

`dev/.env.example` is informational; the stack needs no secrets or `.env` file.
Changing addressing requires changing Compose, Caddy, Nuxt and test origins
together. Never expose the harness's fixed identity as authentication.

## Runtime settings

Deployable wrapper: `NUXT_BACKEND_URL`, `NUXT_CODE_URL`,
`NUXT_PUBLIC_WRAPPER_ORIGIN`, `NUXT_PUBLIC_SYNTHETIC_ONLY=false`.
`NUXT_PUBLIC_EDITOR_ORIGIN` and `NUXT_PUBLIC_WOPI_ORIGIN` identify the fixed CODE
and WOPI hosts. Synthetic-only mode retains its separate exact test host.
The live backend has **no enable-integration switch**.

Harness: `DataDirectory`, `FixtureDirectory`, `EditorOrigin`, `CodeOrigin`,
`WopiOrigin`, `DiscoveryUri`. Configuration is operator-owned; do not accept any
of these from a document, token, message, user form or public request.

## Restart, expiry and recovery

`docker compose -f dev/compose.yaml restart harness` preserves files, versions,
sessions and locks in the SQLite volume. A restart never renews expired tokens.
After 30 minutes the UI reports expiry; save/lock operations deny it. Preserve
edits in the existing editor while arranging an explicit recovery/reopen.
The expiry warning persists and the wrapper disables save requests. An editor
readiness failure or expiry offers a reset only after explicit confirmation
that unsaved edits will be discarded. Save requests that receive no CODE response
within 30 seconds display a timeout and retain the dirty warning.
On 409, never retry by discarding a revision check. Keep the authoritative winner
and recover the losing edits as a distinct manually reconciled version.
Do not clear dirty state merely because CODE acknowledged a save.

Normal stop: `docker compose -f dev/compose.yaml down` preserves synthetic data
and CA. `down --volumes` **destroys** both; use only deliberately for throwaway
fixtures. Back up SQLite with its backup API or stop the writer before copying
the database/WAL; a live copy of only the main file is not a safe backup.
File inspection does not create sessions. Each new admission removes up to 1,000
expired sessions; expiry is still checked on every authorization and mutation.
Synthetic files and their revision histories remain until the owner deliberately
removes the throwaway volume; this harness is not an unbounded hosted service.

## Reusable preparation (not a live topology)

`deploy/render.mjs` accepts JSON with `region`, identical `dataRegion`,
`editorImage`, `backendImage`. Images must be immutable registry
references. See `npm run check:deploy` for non-routable render-test inputs.
Render with `node deploy/render.mjs <your-approved-input.json>`.
No actual environment, registry, credentials or resource owner is hard-coded.
The output has no published ports, no test host, no live adapter, and CODE is in
an explicitly blocked profile. This is a reusable adoption input, not a working
production topology. `artifacts/deploy` contains **fake digest test inputs** and
must never be deployed.

Production/UAT adoption must provide ingress/TLS, region and resource ownership,
network restrictions, secret references, monitoring, vulnerability scans, and
verified immutable artifacts. Use environment-approved, least-privilege OIDC
for a separately authorized registry import/promotion workflow; no shared
credentials and no cloud role exist in this repository's workflows.
Local image IDs are not registry manifest digests. Do not promote them as such.
Promote the same scanned/signed artifacts, not rebuilt equivalents.
The manual preparation workflow retains `office-images.tar.gz`, its SHA-256
checksum, source commit and local image IDs alongside unsigned packages and the
CODE lock for seven days. An authorized promotion process can verify the archive
and use `docker load` rather than rebuilding. Registry digests, scans, signatures,
CODE import and deployment approval are still required separately.

Drain gate before a future live upgrade/rollback: stop new admissions; enumerate
durable sessions; wait for acknowledged conditional saves and lock release;
retain recoverable dirty sessions; expire authorization deliberately; only then
switch traffic. This gate is **not implemented or certified** for live sessions.
The fail-closed backend has zero live sessions to drain. A forced CODE restart
can lose unsaved synthetic edits; verify fresh reopen before stopping the stack.

## Sprint AKS deployment

`deploy-sprint.yml` deploys on pushes to Office `feat/**` branches, **only** to the sprint
dev AKS `verentis-apps` namespace. It does not deploy UAT/production or enable
`manifests/environments/production.yaml`. It builds the live editor and WOPI
backend from this commit and applies their ACR **manifest digests** and the
official CODE digest in `deploy/code.lock.json`; it never deploys the synthetic
harness. `npm run check:deploy` runs the offline shape and failure contract
without a cluster. No cloud deployment is performed by that check.

Create the Office GitHub environment `sprint` with deployment branches restricted
to `feat/**` and a required reviewer. The deployment job reads the following
**environment secrets** (not repository variables). GitHub variables are not
automatically displayed to the public, but workflow code can print their
values in public logs; secrets are encrypted and log-masked, though a malicious
workflow run by someone with write access can still exfiltrate them. Review
feature-branch changes before approving a deployment. Do not run this workflow
from a fork or enable pull-request deployment.
The separate secret-free checks also run on feature pushes without waiting for
deployment approval. Approving the `sprint` environment releases the deployment
job; an unapproved run cannot access the environment secrets or request its
Azure OIDC credential.

Deploy the Platform Security and Workspace changes first, including the
`/v1/app-embeds` and `/v1/workspaces/resolve-host` API gateway routes, the
Security app-embed Cosmos container and `AppEmbeds:OfficeOrigin`. Office now
fails closed without that contract; pushing its `main` branch before Platform
is upgraded makes new live launches unavailable. Verify the gateway and
container before the Office push.

| Environment secret | Required value |
| --- | --- |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | Sprint OIDC identity and tenant/subscription GUIDs, available from Platform's `sprint` environment variables. This identity **must** separately trust `repo:verentis/office:environment:sprint` (not just the Platform repository); otherwise Azure login fails. Limit its permissions to sprint ACR push and AKS deployment. |
| `ACR_NAME`, `ACR_LOGIN_SERVER` | Sprint ACR name and matching `<name>.azurecr.io` host, available from Platform's repository variables; AKS must be able to pull from it. |
| `AKS_CLUSTER_NAME`, `AKS_RESOURCE_GROUP` | Sprint dev AKS cluster and resource group, available from Platform's `sprint` environment variables. |
| `OFFICE_PLATFORM_ORIGIN` | The target sprint API, e.g. `https://api.sprint-9.verentis.dev` (no trailing slash). |
| `OFFICE_CLIENT_ID` | Nonzero GUID of a separately registered Office backend client, paired with its installation by the platform owner; never reuse the local/test client. |
| `OFFICE_BACKEND_SECRET` | **Name**, not value, of a pre-provisioned Kubernetes Secret in `verentis-apps` with nonempty key `ClientSecret` (independent backend credential). The credential itself remains only in Kubernetes. |
| `OFFICE_STATE_PVC` | Name of a pre-provisioned, Bound, durable RWO/RWOP PVC in `verentis-apps`, with sufficient capacity for SQLite/WAL and the DataProtection `keys/` directory. Retain/back up the claim independently of deployments. |

The workflow checks all settings, lock syntax and the pre-provisioned namespace,
secret and PVC before building, and checks the objects again before apply. It
checks that `ClientSecret` is nonempty without printing its value; missing inputs fail rather
than deploying an unconfigured backend. Secret values are read only by the pod
from Kubernetes; never put them in workflow files or manifests.
The backend uses one replica, `Recreate` upgrade strategy, a claim mounted at
`/data`, and an init container that grants the .NET non-root user (UID 1654)
ownership of the claim directory. The backend's startup lock also rejects a
second writer. Back up the **whole** directory including WAL and `keys/` with
SQLite backup API or with the writer stopped; deleting the claim invalidates
existing protected session credentials. Storage provisioner must permit the
init container to set ownership; validate this with a first-rollout restart.

Create public DNS (external-dns or operator-managed) and allow cert-manager's
`letsencrypt-prod` issuer to issue separate certificates for:

- `https://office.apps.verentis.dev` — wrapper; Nuxt server-side API calls use
  private `http://office-wopi:8080`.
- `https://office-code.apps.verentis.dev` — CODE HTTPS/WSS at ingress; discovery
  and websocket traffic must reach port 9980.
- `https://office-wopi.apps.verentis.dev` — CODE/browser WOPI callbacks at port
  8080; HTTPS certificate must be trusted by CODE's normal system CA store.

The existing platform certificate for `*.verentis.dev` does **not** cover the
`*.apps.verentis.dev` hosts. CODE's upstream HTTP terminates TLS at nginx;
`ssl.ssl_verification=true` is retained for outgoing HTTPS WOPI callbacks and
CODE advertises its public HTTPS host. Its frame ancestors include only the
Office wrapper as its fixed built-in origin; the authenticated CODE HTML proxy
replaces that directive with the platform-bound workspace origin as well. All Office
ingresses disable nginx access logs because WOPI access tokens are in URLs;
maintain the same prohibition in other proxies/APM, and do not log query strings.
Do not route the WOPI ingress through a proxy that forwards tokens to logs.
Check network policy/cluster egress allows CODE and backend to resolve/reach
their public HTTPS callback/discovery origins, and that cluster trust includes
the issuer's root. No mkcert private/public local CA material is deployed.

**Rollout gate:** wait for all three Deployment rollouts, all three issued TLS
certificates, HTTPS CODE discovery, wrapper `/_ready` and configured backend
`/health` (the workflow does these checks). Then authorize an actual session
with the separately paired backend identity, confirm a save and reopen, and
restart the backend to check session/keys survival before admitting users.
Green process readiness does not prove platform pairing or durable saves.
The browser/CODE framing flow must be validated against the platform's issued
embed ticket and an actual registered workspace before admitting users.
Marketplace package approval/publication is a separate action.

**Sprint upgrade risk:** pushing changes to the Office repository can restart
the wrapper or backend. Kubernetes leaves CODE running when its rendered pod
template (including its pinned digest and frame policy) has not changed; a CODE
version/configuration change or node failure can nevertheless restart it and
lose unsaved in-memory edits. CODE is intentionally not auto-updated from
upstream tags. Blue/green CODE routing and migration of active sessions are
deferred; sprint auto-deployment is not a lossless live-upgrade guarantee.

**Rollback/upgrade:** before replacing any live component, stop new admissions,
drain outstanding saves/locks and preserve recoverable dirty sessions. This
drain gate is not automated or certified: coordinate it manually with the
platform owner. Retrieve prior immutable editor/backend image digests from the
last successful workflow run, keep the CODE digest compatible, and restore the
previous rendered workload images (or revert the commit and deploy only after
drain approval). Do not delete or recreate the PVC/secret; verify sessions
and fresh reopen after rollback. A forced CODE restart may lose unsaved edits.
