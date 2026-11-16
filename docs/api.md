# Office browser contract

Office is a wrapper and Collabora CODE deployment, not a WOPI host. All WOPI
callbacks go directly to the platform gateway at `/wopi/files/{stableDocumentId}`.
Collaboration owns admission, credentials, locks, save receipts and persistence.

The workspace host first reads the authoritative path metadata using
`GET /v1/files/{path}?branch=main&pageNo=1&pageSize=25&metadataOnly=true`.
This explicit projection retains normal user/workspace authorization and content
metadata, but returns `children: null` without querying the Search index. App and
engine surfaces do not need child listings. Browser surfaces subsequently request
the normal projection, which retains directory/archive pagination and reports
Search failures rather than substituting an empty listing. Omitting
`metadataOnly` preserves the existing metadata-plus-children API behavior.

## Trusted parent bridge

The SDK `Bridge` uses `verentis:wopi:request` / `verentis:wopi:response` with an
exact parent window/origin, host-session ID and unique request ID. The child may
request `launch`, `status`, `save` (with a nonnegative edit generation), or `close`.
It cannot choose the installation, user, document, branch or permission ceiling.
The authenticated platform host supplies these from the current file surface.

The launch contains `sessionId`, `workspaceId`, `branch`, `nodeId`, `fileId`, `format`,
`name`, `readOnly`, `editorOrigin`, `action`, `wopiSource`, `accessToken` and
absolute epoch-millisecond `accessTokenTtl`. Only this document-scoped token
reaches CODE, through a hidden form POST to the trusted discovery action.
Token lifetime policy belongs to the admitted platform profile; the wrapper
rejects expired or malformed timestamps rather than imposing a separate maximum
lifetime. Expiry timers recheck the deadline and respect browser timer limits.
The parent retains its normal OAuth token and the returned `credentialId`.
WOPI-only Office declares no ordinary workspace API permissions.
The backend names its discovered destination `editorUrl`; the trusted parent
maps it to the SDK's `action` field and validates the returned `editorOrigin`.
The backend's `readOnly` ceiling can never be elevated by that mapping.
The absolute WOPISrc and its single matching occurrence in the discovered action
are validated and forwarded unchanged; the parent does not rebuild either URL.

Office package `0.1.10` explicitly requests signed `operations: [rename, delete]`.
These optional operations require fresh document-processing consent and live
operation-specific user grants; they do not grant ordinary OAuth scopes.
Omitted operations authorize neither rename nor delete. Republishing and
reconsenting are required before an existing installation can use them;
ordinary open/edit/save remains available under its existing consent.

`fileId` is the opaque stable Collaboration document key, not the Node ID.
`nodeId`, workspace and branch bind the launch to the current parent file context.

Save checkpoints contain `generation` and opaque `correlation`. The wrapper
sends that correlation as Collabora `Action_Save.Values.ExtendedData`.
Pinned CODE forwards it on PutFile as `X-COOL-WOPI-ExtendedData`. Release-series
source: [Action_Save mapping](https://github.com/CollaboraOnline/online.mirror/blob/825c9caa93da8651971522ba82a80fa0777539c0/browser/src/map/handler/Map.WOPI.js#L695-L702)
and [WOPI header construction](https://github.com/CollaboraOnline/online.mirror/blob/825c9caa93da8651971522ba82a80fa0777539c0/wsd/wopi/WopiStorage.cpp#L395-L400),
[PutFile forwarding](https://github.com/CollaboraOnline/online.mirror/blob/825c9caa93da8651971522ba82a80fa0777539c0/wsd/wopi/WopiStorage.cpp#L828-L843).
The pinned running image still requires warm verification.
Manual saves initially use the requesting CODE session, but failed uploads can
retry with another writable session while retaining extended data
([writer selection](https://github.com/CollaboraOnline/online.mirror/blob/825c9caa93da8651971522ba82a80fa0777539c0/wsd/DocumentBroker.cpp#L702-L709),
[attribute retention](https://github.com/CollaboraOnline/online.mirror/blob/825c9caa93da8651971522ba82a80fa0777539c0/wsd/DocumentBroker.cpp#L3868-L3870)).
The platform must independently authorize that writer and keep the checkpoint
bound to the same session/document/installation; status and close remain bound
to the requesting browser's credential and authenticated principal.
Status contains `state`, `revision`, `readOnly` and an optional durable receipt
with `generation`, `correlation`, `revision`. Dirty state clears only if the
receipt matches the requested generation and correlation and records a durable
revision, no later local edit occurred,
and CODE reports no pending modification. CODE's save acknowledgement alone
never proves persistence.
The confirmed revision comes from that immutable receipt; a later coauthor
commit may advance the current document revision without invalidating it.

The authenticated parent calls:

- `POST /v1/collaboration/sessions` before navigating the wrapper, using the
  current installation/document binding and signed wrapper origin. It retains
  the returned launch and `credentialId`, navigates with the short-lived
  `embedTicket`, then supplies scoped launch fields only after the exact-origin
  SDK handshake. The ticket and control identifier are not included in that
  child launch.
- `POST /v1/collaboration/sessions/{id}/saves` with `{generation, credentialId}`.
- `GET /v1/collaboration/sessions/{id}/status?credentialId=…&correlation=…`,
  omitting correlation until a checkpoint is requested.
- `DELETE /v1/collaboration/sessions/{id}?credentialId=…`, revoking only this
  browser launch's credential, not another participant or tab.

No separate status secret or `X-Collaboration-Status` header is used. The child
cannot choose these IDs; the parent obtains them from the admitted launch.

## Save As continuation

An exact-window/origin-validated CODE `UI_SaveAs` opens Office's accessible
HTML filename form. Cancel sends nothing and preserves the source and dirty
state. Confirm validates a leaf filename in the requested supported editable
format, then sends only `Action_SaveAs` with `Values: {Filename, Notify: true}`
to that CODE window. The filename is a requested name, not a Node/path/permission
grant; platform PutRelative remains authoritative. There are no target IDs,
OAuth credentials, or checkpoint correlations in this message.

An active save, unavailable/expired authorization, or outstanding continuation
blocks submission. After confirmation, source save controls stay blocked and
the old checkpoint is discarded. An unverified timeout does not silently retry
the operation. A CODE failure requires another live status check before retry.
CODE format requests for view/export-only or unsupported formats are reported
explicitly, not converted into a different operation.

CODE's rename reload can invalidate its document-loaded state before a new
`Frame_Ready` notification arrives. The form may open during loading, but
confirmation waits for readiness. Before dispatch, Office sends the supported
`Get_Views` request and waits for its exact-window/origin `Get_Views_Resp`, which
CODE processes only while its document is loaded. A request ignored during
reload is probed again after `Document_Loaded`; the Save As command itself is
sent only once. Readiness timeout is reported as **not sent**, distinct from an
unverified dispatched operation. Existing dirty state, iframe and token remain.

CODE can switch its WOPISrc and scoped token after PutRelative, then emit
`Action_Save_Resp` with a filename. This is a continuation signal, not a source
save receipt; no filename, node ID or credential from that postMessage grants
target authority.

The authenticated parent reads the persisted completed-operation receipt from
`GET /v1/collaboration/sessions/{sourceId}/derived?credentialId=…`.
It contains the server-selected target identity, original `acquisitionId` and
the persisted target credential's absolute epoch-millisecond `accessTokenTtl`.
The parent exposes only `continuationAvailable` to the SDK child. The ID-free
`continue` bridge operation rechecks source and target authority through this
endpoint and binds its exact existing session/credential IDs parent-side.
It never reconstructs a launch or mints a replacement token: signing-key rotation
must not prevent control of a still-valid CODE credential.

The child receives a nonsecret `WopiContinuation`: `sessionId`, `workspaceId`,
`branch`, `nodeId`, `fileId`, `name`, `format`, `readOnly`, `accessTokenTtl`.
No token, credential ID, action URL or WOPISrc is returned. The wrapper rejects
malformed, expired, credential-bearing or cross-workspace/branch responses.

Once rebound, the parent replaces the control binding and drops the source
save correlation. Old in-flight replies are rejected. Save and close recheck
status and cannot act on a source with an outstanding derived continuation.
The wrapper keeps its initial launch/form separate from active document metadata
and updates the latter and its expiry without resubmitting a form, replacing
CODE's existing token or recreating its iframe. Dirty state remains until a
matching target checkpoint is durably committed.

## Server-side framing

`GET /?embedTicket=…` consumes a platform-issued installation/parent-bound ticket
via `/v1/collaboration/embeds/authorize`. The default CSP denies all ancestors;
successful authorization admits exactly the trusted workspace origin.
Direct public navigation without an authorized ticket fails closed.
The platform validates the launch request's actual HTTP `Origin` against
Security's registered host for the authenticated workspace, then binds that
parent origin into scoped credentials and the embed ticket. Later authorization
rechecks that the host remains registered. The launch body's `origin` is the
separate signed wrapper origin; no caller-supplied parent-origin body field or
fixed parent-origin configuration grants framing authority.

`POST /browser/{version}/cool.html?WOPISrc=…` validates the scoped token and exact
platform WOPI source through `/v1/collaboration/frames/authorize`, then proxies
the document to CODE. Only its `frame-ancestors` directive is narrowed to the
authorized parent and wrapper. Ambiguous/missing CSP, redirects, duplicate
credentials and untrusted sources fail closed. Static CODE browser assets use GET.
The wrapper uses `strict-origin` referrer policy in both headers and HTML. CODE's
cross-origin form POST therefore retains the exact wrapper `Origin`, while the
referrer excludes the embed ticket, path and query. `no-referrer` would make that
form's Origin `null`; the proxy deliberately rejects null or unapproved origins.

There is no Office `/api/sessions`, `/test`, OAuth backend, WOPI or storage API.
Successful static assets beneath a hexadecimal, content-versioned `/browser/{version}/`
path are publicly cacheable for one year when the request and response carry no
credentials or cookies. Document HTML, query-bearing and non-versioned paths,
and failed responses remain non-cacheable. Never record credentials, document
bodies, full launch URLs or form bodies in logs, screenshots or traces.
