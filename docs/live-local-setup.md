# Live local Office integration

This is a **local development preview**, not a production-readiness or
per-format fidelity claim. Office's local overlay registers the formats
below. Production manifests retain disabled claims. The older
`tests/fixtures/office-live.app.yaml` remains an XLSX-only acceptance fixture;
it is not the complete package manifest.

## Supported format registration

`apps/editor/shared/formats.json` is shared by backend admission, discovery and
browser launch validation. `npm run sync:formats` generates the local manifest's
MIME bindings and extension-to-MIME rules; `npm run check` rejects drift.
Every registered extension/action was checked against the digest-pinned CODE
discovery. Formats with no advertised edit action are forced read-only by the
backend, even if their MIME type is shared with an editable format.

| Family | Registered extensions |
| --- | --- |
| Word / Writer | DOCX, DOC, DOCM, DOT, DOTX, DOTM, ODT, OTT, FODT, ODM, OTM, OTH |
| Excel / Calc | XLSX, XLS, XLSM, XLSB, XLA, XLTX, XLTM, ODS, OTS, FODS |
| PowerPoint / Impress | PPTX, PPT, PPTM, POT, POTX, POTM, PPSX, ODP, OTP, FODP |
| Text and tabular interchange | RTF, TXT, MD, CSV, TSV, DIF, SLK, DBF |
| Draw / Visio / Publisher | ODG, FODG, OTG, VSD, VSDX, VSS, PUB |
| Legacy OpenOffice | SXW, STW, SXG, SXC, STC, SXI, STI, SXD, STD |

DOT, POT, OTM, OTG, Visio, Publisher and legacy OpenOffice formats are view-only.
Plain text and Markdown have lower selection priority, so installing Office
does not displace existing text/code editors. RTF and CSV MIME aliases are
included. No wildcard claims or unsupported Access, OneNote, Base or Math file
types are registered. Macro-capable formats are not a promise that macros run
or that every Microsoft-specific feature survives a round trip.

The live editor fills its iframe without wrapper padding, borders or permanent
diagnostic chrome. Save and Office status are workspace header actions.
Loading, authorization, conflict and save-failure messages remain available;
failure notices appear over the editor without removing it or discarding edits.

## Preparation

Use .NET 10, Node 24, a separately authenticated Verentis CLI, and the normal
platform Aspire host with trusted local TLS. Do not recreate an existing Cosmos
container or volume. Keep the CODE image pinned by `deploy/code.lock.json`.

The changed SDK is consumed as an explicit local tarball, not an unpublished
registry version or an implicit runtime link to a sibling checkout:

```sh
node scripts/use-local-sdk.mjs /absolute/path/to/sdk
npm run check
dotnet test tests/protocol/Office.Protocol.Tests.csproj
```

The script builds and packs SDK 0.2.0 into `vendor/sdk/`, installs that artifact,
and records its integrity in the lockfile. Keep the archive with the source
change set: a standalone checkout and the editor Docker build consume it without
a sibling checkout or registry publication. Refreshing the artifact requires an
explicit SDK checkout with its npm dependencies installed; ordinary `npm ci`
does not. The package retains its MIT license. No package is published.

## Publisher-hosted Office in local Aspire (new installations)

Run `platform` and `office` as sibling checkouts, with the normal platform
Aspire AppHost, trusted local certificates and an authenticated publisher
administrator. The administrator must own the Marketplace publisher and have
the account-level `security.appbackendclient.create` grant. Use a dedicated
test workspace and document; this is the same flow whether that workspace
belongs to the publisher or to another customer.

1. On the **account publisher page**, register a hosted service with
   environment `local` and endpoint **`https://office.localtest.me`** (an exact
   HTTPS origin, with no path). Copy its client ID and **one-time** client
   secret before closing the dialog. A service-account API key, the package
   signing key and the older `/v1/app-backend-clients` credential are not
   substitutes. Do not run `scripts/setup-local-backend.py` for this flow:
   that helper registers the older account-owned client.
2. From the `verentis` directory, store the new credentials in **AppHost
   user-secrets**. Replace any previously saved `Office:ClientId` and backend
   secret from an older preview. Only the client ID appears in the command
   arguments; the hidden prompt sends the secret to `dotnet` as JSON on stdin.

   ```sh
   dotnet user-secrets set --project 'platform/src/0 - Aspire/Verentis.AppHost/Verentis.AppHost.csproj' \
     'Office:ClientId' '<issued-local-client-guid>'
   python3 -c 'import getpass,json; print(json.dumps({"Parameters:office-backend-client-secret":getpass.getpass("Office client secret: ")}))' |
     dotnet user-secrets set --project 'platform/src/0 - Aspire/Verentis.AppHost/Verentis.AppHost.csproj'
   ```

   AppHost maps these to `Office__ClientId` and `Office__ClientSecret` on
   `office-wopi`, and supplies `Office__PlatformOrigin` from the local API
   gateway. The backend defaults to `oauth`; do **not** add a legacy-mode
   override. Do not put this **local** secret in `.env`, the manifest, GitHub,
   a shell argument, a screenshot or logs. Sprint uses a separate credential
   in the GitHub `sprint` environment's `OFFICE_CLIENT_SECRET` secret.
   `dotnet user-secrets list` prints secret values, so do not paste its output
   into a ticket.
3. **Reload AppHost's resource model** after changing the user-secrets;
   restarting just `office-wopi` does not reread AppHost's parameter or new
   gateway routes. Preserve the existing Cosmos containers and Office live
   data directory; do not tear down the entire shared stack just to refresh
   credentials. Check the public local health endpoint without exposing the
   secret:

   ```sh
   curl --fail --cacert platform/scripts/.certs/rootCA.pem \
     https://office-wopi.localtest.me/health
   ```

   A response with `backendConfigured: true` proves configuration is present,
   **not** that the client is authorized to read files.
4. Prepare a **new, developer-signed** Marketplace Office version bound to
   this exact client, environment and endpoint. The local overlay's file
   formats and permissions do not by themselves request hosted access.
   A hosted overlay must contain:

   ```yaml
   spec:
     capabilities: [hosted-backend]
     hosted-backend:
       client-id: <issued-local-client-guid>
       environment: local
       endpoint: https://office.localtest.me
   ```

   Use the publisher's Ed25519 signing key whose **public** half is registered
   with the same publisher in the **local** Platform. The CLI targets
   production by default: authenticate and publish against
   `https://api.localtest.me:6500`, not the production registry. Pack from the
   Office checkout:

   ```sh
   verentis pack manifests --env local \
     --overlay /absolute/path/to/hosted-local.yaml \
     --key YOUR_REGISTERED_KEY_NAME --set-version NEW_UNPUBLISHED_VERSION
   ```

   Verify the resulting package and publish that **exact** signed version.
   The packages produced by `npm run check`
   use `--no-sign`: they are useful for validation but **cannot** obtain
   hosted-backend authority. Never insert a client secret into a package.
5. Install that version in the test workspace. A workspace administrator
   reviews the verified service operator, version, endpoint and requested
   permissions, then approves Resource's exact installation candidate.
   Installing in your **own publisher workspace still requires approval**;
   being the publisher does not grant access to every document. Only a user
   with current rights to the chosen file may launch it.

`HostedServices:Enabled` in **Security** defaults to `false`; setting the
Office credentials does not turn it on. Keep it off until the signed package,
live installation proof and admin consent have been checked in an isolated
local acceptance environment. Enabling it is a separate, deliberate Security
process configuration change, not another Office credential. Verify launch,
save/reopen and revocation before enabling it in sprint or production. Missing
proof, consent, credentials or authorization must deny launch without creating
an Office/WOPI session.

If Office still reports `office_backend_setup_required`, check the AppHost
user-secret **keys** and reload boundary without printing their values. If the
backend is configured but `/connect/token` or hosted exchange denies access,
check the client/environment binding and Security gate; do not fall back to an
API key or the legacy exchange. A copied manifest or unsigned local package
cannot satisfy Marketplace's signed-binding proof.

## Earlier local same-account preview

The setup helper below is retained for historical, account-owned `legacy`
previews; **do not run it for a new installation**. AppHost forwards the ID
and secret but does not forward a legacy-mode override, so those two settings
alone cannot make this helper's credential work with today's default OAuth
backend. This is not a hosted publisher installation or a production
onboarding guide. New
Office installs require a developer-signed Marketplace version bound to a
publisher-owned service credential and explicit workspace-admin approval,
including in the publisher's own workspace. Office now defaults to `oauth`;
leave Platform hosted admission off until the complete local signed-install,
consent, launch/save/reopen and revocation flow has been verified.

1. Create a separate test workspace and upload an original XLSX using the normal
   CLI files API. Never edit a customer's workbook for acceptance.
2. Install/register the local Office acceptance manifest through the supported
   workspace file/installation APIs. There must be one Office registration, not
   two same-name registrations. Updating consumed permissions invalidates old
   consent. Do not edit registry/database rows.
3. Use an authenticated account-authorized developer and workspace administrator
   to run the explicit setup command below. It invokes supported `verentis api`
   operations, captures returned secrets privately, and sends JSON through stdin
   to `dotnet user-secrets set`. Secrets never appear in command arguments or
   console output.

For a **new isolated workspace with no Office registration**, register the local
candidate by uploading its manifest through the normal file API:

```sh
VERENTIS_API_URL=https://api.localtest.me:6500 \
  node /absolute/path/to/cli/dist/index.js files upload \
  tests/fixtures/office-live.app.yaml /office-live.app.yaml \
  --workspace YOUR-ISOLATED-WORKSPACE-GUID --branch main \
  --content-type application/vnd.verentis.application+yaml
```

Resource registration is asynchronous. Wait until the installation-list endpoint
below returns exactly one `office` entry. If Office is already installed, do not
add a second registration: use the existing supported update/uninstall flow
with the workspace owner's approval instead.

The changed Security/Resource services and gateway routes must be running before
provisioning. If the old host does not expose those routes, coordinate its model
reload first; an unconfigured live backend deliberately returns 503. After the
helper stores the independent backend credentials, reload the Office runtime
configuration as described below. No temporary test credential is needed.
The helper requires an explicit `Office:DelegationAuthMode=legacy` override for
this earlier local preview. Do not use it to provision a hosted publisher
client. The default `oauth` mode requires the approved signed-package and
hosted-client contracts; see [backend authentication rollout](operations.md#sprint-aks-deployment).

```sh
python3 scripts/setup-local-backend.py \
  --cli /absolute/path/to/cli/dist/index.js \
  --apphost '/absolute/path/to/platform/src/0 - Aspire/Verentis.AppHost/Verentis.AppHost.csproj' \
  --workspace YOUR-ISOLATED-WORKSPACE-GUID --approve
```

The helper deliberately targets the local API at `https://api.localtest.me:6500`.
It inherits the CLI's configured TLS policy; a previously saved insecure CLI
setting is **not** evidence of strict TLS. Browser, backend and CODE certificate
validation remain enabled independently.

Public setup operations:

| Operation | Endpoint | Authority |
|---|---|---|
| Register independent backend | `POST /v1/app-backend-clients` | Account user; `security.appbackendclient.create` |
| List workspace installations | `GET /app-installations/app-installations?workspaceId=…` | Workspace user; `resources.resource.read-all` |
| Approve pairing and consumed permissions | `PUT /app-installations/approve-app-installation` | Workspace administrator; `resources.resource.update` |
| Rotate/deactivate backend | `POST /v1/app-backend-clients/rotate` or `/deactivate` | Owning developer with update/delete scope |

Pairing consents to `node.file.read` and `node.node.create`, the existing Node
conditional-content write scope. The latter does not make the delegated
credential usable on create/path/list/upload APIs.

## Runtime configuration and browser login

The older setup helper also writes these AppHost user-secrets; for the
publisher-hosted flow use the registration and secure prompt above instead:

- `Office:ClientId`
- `Parameters:office-backend-client-secret` (the corresponding one-time credential)

There is no Office parent-host allowlist. Platform resolves the actual page
origin against the active workspace-domain registry before issuing a one-use
embed ticket or file delegation. The wrapper pins the browser's parent window
and origin; the backend compares that origin to the platform-bound delegation
before issuing a WOPI token. An expired embed ticket requires reopening the
app from the workspace, which obtains a new ticket.

If a workspace domain is revoked while a document is open, new frame loads and
subsequent platform-backed callbacks must fail closed. The current MVP cannot
transfer unsaved CODE memory to another host; keep the browser open and arrange
recovery with the workspace owner rather than attempting to bypass domain
revocation or forcing a conflicting write.

Normal Aspire wires Security's `AppDelegations__PlatformOrigin` and Node's
`AppDelegations__SecurityOrigin` to the public API origin. It routes the new
delegation/backend-client APIs and the existing unversioned consent APIs.
`office-wopi` now runs `services/backend/Office.Backend.csproj`; the synthetic
store stays solely in the explicit test harness. The wrapper uses the live
backend, and CODE's framing policy includes the configured workspace ancestor.

Changing a resource from the old harness container to a project and adding
gateway routes requires an **AppHost resource-model reload**, not merely
restarting the old `office-wopi` container. Coordinate that boundary with the
environment owner; do not stop/recreate the whole stack or persistent storage
incidentally. After model reload, changed services are Security, Resource,
Node, API/frontend gateways, Office backend,
Office wrapper, CODE (frame policy), and workspace. CODE document HTML routes
through the Office wrapper's server-side proxy; other CODE paths go directly
to CODE. Do not route CODE WebSockets through the wrapper.

Open `https://WORKSPACE-GUID.localtest.me/`. The generic
`workspace.localtest.me` service alias is not a workspace and cannot complete
workspace OIDC. GUID hosts work without custom-domain rows. Complete the real
identity-provider login; CLI authentication does not log the browser in.
The current platform AppHost rotates token-signing keys on a full host restart,
so a previously authenticated CLI/browser may need to sign in again. Restarting
only a changed Office resource avoids that rotation.
No test identity, synthetic WOPI token or platform service secret is accepted by
the Office session endpoint.

## Contracts and recovery

- Host → SDK: correlated `verentis:backend:request/response`, bound to the current
  iframe source, exact origin and host session. The app supplies no recipient,
  workspace, file, branch or scope selection.
- Security: two-minute single-use launch; five-minute opaque Node access;
  eight-hour absolute delegation ceiling. Renewal preserves its original
  response under native ETag concurrency and rechecks current authority.
- Office: the platform-issued one-use embed ticket authorizes the wrapper's
  initial frame response with an exact parent CSP. `POST /sessions` exchanges
  the installation's launch credential and compares its bound origin to the
  browser-observed parent before creating a scoped WOPI token. The CODE HTML
  proxy replaces only the frame-ancestor directive after verifying that WOPI
  token with the backend; it leaves the remaining CODE policy intact.
- Node: stable-node metadata/content APIs with explicit `X-Branch`; content PUT
  uses strong `If-Match` and a durable `Idempotency-Key`.
- Browser: `GET /sessions/{id}/status` requires a separate status credential.
  A CODE save acknowledgement or a changed revision alone does not clear dirty
  state. `POST /sessions/{id}/saves` creates a durable edit-generation checkpoint.
  Its nonce travels through CODE's `Action_Save.Values.ExtendedData` and
  `X-COOL-WOPI-ExtendedData` (legacy header also accepted). The corresponding
  receipt commits atomically with local recovery state, only after Node confirms
  the conditional save. The wrapper additionally requires no newer edit
  generation, CODE reporting unmodified, and the receipt revision still current.
  Missing/late/unrelated callbacks leave dirty set. A real XLSX save reached the
  confirmed-revision state, and an independently downloaded workbook contained
  the typed marker. Other format fidelity and failure/restart scenarios need
  their own live acceptance; adapter coverage is not a substitute.
- Durable coordination resides in `artifacts/live-data/office.db`. Session
  credentials and pending write bytes are encrypted with a persistent
  DataProtection key ring under `keys/`. Preserve the database **and** keys
  together across restarts; restrict the directory to its owner.
- Pending writes persist before the API call. Recovery repeats the original
  bytes, revision and operation identifier; it never rebases an old snapshot
  over a newer external revision. Known conflicts retain pending bytes.
  An explicit authenticated session close may discard known-rejected pending
  bytes belonging to that session; ambiguous outcomes must first be resolved.
- One backend process holds an exclusive ownership file; a second instance
  fails startup. This is intentionally not a multi-replica design.
- Create an empty `draining` file in the data directory to reject new sessions
  while existing callbacks continue. Remove it to resume admission. Do not
  remove coordination state to “fix” a conflict.

Protocol/adapter tests use explicit test doubles or the isolated synthetic
harness. Real local acceptance also covers authenticated XLSX rendering,
correlated durable saving and an unchanged original-workbook render. It does not
prove every format's fidelity, collaboration, or a production restart.

Protocol field references: Collabora's public `online.mirror`
[`Map.WOPI.js`](https://github.com/CollaboraOnline/online.mirror/blob/master/browser/src/map/handler/Map.WOPI.js)
and [`WopiStorage.cpp`](https://github.com/CollaboraOnline/online.mirror/blob/master/wsd/wopi/WopiStorage.cpp).
The currently pinned local browser bundle and server binary both contain
ExtendedData support. That read-only asset check is not a saved-workbook test.
