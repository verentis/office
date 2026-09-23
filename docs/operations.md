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
| `https://office-wopi.localtest.me` | Synthetic harness HTTP port 8080 |

These are exact host routes at order 0, ahead of the workspace wildcard at 100.
The original Host is preserved. The gateway has the Aspire container-network
alias `office-wopi.localtest.me` and listens internally on 443, so CODE does
**not** resolve callbacks to its own loopback or depend on host-gateway forwarding.
CODE mounts only the public CA file read-only and uses
`ssl.ssl_verification=true`, explicit `ssl.ca_file_path` / `storage.ssl.ca_file_path`
and OpenSSL `SSL_CERT_FILE` pointing at `/etc/ssl/certs/office-rootCA.pem`.
No CA private key or leaf private key is mounted into CODE. Its frame ancestors
admit only the Office wrapper, not arbitrary workspace/parent origins.

Harness discovery uses Aspire's internal CODE endpoint. Nuxt uses the harness
endpoint directly. CODE discovery → harness health → Nuxt `/_ready` determines
startup readiness. The gateway references routes without waiting on callback
dependencies, avoiding a startup cycle. `verentis-office-synthetic` is a named
Docker volume retaining synthetic SQLite data across host restarts.
Normal shutdown preserves it. Do not delete it unless deliberately discarding
all synthetic files, versions, sessions and locks.

The normal platform gateway's existing certificate policy on private Nuxt
upstreams is unchanged; browser ingress and CODE callback verification are
separate, trusted TLS paths. Keep this local harness private. Publish and
`ASPIRE_TEST_MODE` do not add Office resources or require its checkout/certificates.
The production wrapper/backend remain fail-closed.
Office registration suppresses ASP.NET request and YARP informational proxy
logging on the shared local gateway because WOPI credentials occur in URLs.
The Aspire browser suite checks gateway/CODE/harness output for plaintext
credential URLs; do not re-enable verbose proxy logs during document sessions.

For focused validation without starting/stopping unrelated services:

```sh
# From platform/, with port 443 free and the shared certificate ready
dotnet run --project utilities/local-office
# In another terminal, from office/
mkdir -p artifacts
PLAYWRIGHT_BROWSERS_PATH="$PWD/artifacts/browsers" TMPDIR="$PWD/artifacts" npx playwright install chromium
NODE_EXTRA_CA_CERTS="$PWD/../platform/scripts/.certs/rootCA.pem" npm run test:aspire
```

The focused host links the same Office registration used by the normal AppHost,
not a reimplementation. Its dashboard uses `https://localhost:18890`.
The browser must already trust the mkcert CA; the Aspire test does not disable
TLS validation, install trust or accept arbitrary self-signed certificates.
It checks trusted ingress, discovery, WSS, a real CODE edit/save, fresh-context
reopen/re-edit and blocked live admission. Do not run focused and full hosts
together. Ctrl+C stops only resources owned by that host.
Linux machines missing browser libraries need the Playwright `--with-deps`
installation option. The Aspire suite is an explicit required verification gate
for local-host/certificate changes; standalone Office CI cannot run it without
the sibling platform checkout and preconfigured browser CA trust.
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

Deployable wrapper: `NUXT_BACKEND_URL`, `NUXT_PUBLIC_PARENT_ORIGIN` (exact trusted
workspace origin); `NUXT_PUBLIC_SYNTHETIC_ONLY=false`. Test-only wrapper settings:
`NUXT_PUBLIC_EDITOR_ORIGIN`, `NUXT_PUBLIC_WOPI_ORIGIN`, syntheticOnly=true.
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

## Deployment preparation, not adoption

`deploy/render.mjs` accepts JSON with `region`, identical `dataRegion`,
`parentOrigin`, `editorImage`, `backendImage`. Images must be immutable registry
references. See `npm run check:deploy` for non-routable render-test inputs.
Render with `node deploy/render.mjs <your-approved-input.json>`.
No actual environment, registry, credentials or resource owner is hard-coded.
The output has no published ports, no test host, no live adapter, and CODE is in
an explicitly blocked profile. This is a reusable adoption input, not a working
production topology. `artifacts/deploy` contains **fake digest test inputs** and
must never be deployed.

Platform adoption must provide ingress/TLS, region and resource ownership,
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
