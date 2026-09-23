# API and protocol

All responses are non-cacheable. Credentials must never enter diagnostic logs,
traces, screenshots, analytics or URLs in bug reports.

## Deployable backend

| Method/path | Result |
| --- | --- |
| `GET /health` | 200; healthy process, `liveIntegration: disabled` |
| `POST /sessions` | 503; `platform_prerequisites_missing`, actionable gates; no body credential consumed |
| `/wopi/**` GET/POST/PUT/DELETE | 401; no content or mutation |
| `/test/**` | 404; these handlers do not exist |

## Synthetic executable only

`POST /test/sessions` accepts JSON `{ "format": "docx", "fileId": null,
"readOnly": false }`. Omit fileId to clone an original fixture; provide the
32-character synthetic ID to reopen that persisted file. Format must match.
Requires exact `Origin: https://office.localhost:8443` and
`X-Test-Identity: synthetic-user`. These are test-only checks, not credentials
and not protection against local command-line clients.

The response includes `action`, `accessToken`, absolute epoch-millisecond
`accessTokenTtl`, `fileId`, `format`, `editorOrigin`, `wopiSource`, and
`syntheticOnly: true`. Sessions live 30 minutes. Reopening is explicit, not renewal.
`GET /test/files/{id}` uses the same test headers and returns version/name/base64
content for independent persistence assertions.
The Nuxt `/api/` proxy only exposes these routes when `syntheticOnly=true`;
it never forwards browser Authorization headers or cookies.
Synthetic launch JSON requires Content-Length (411 if absent), limited to 4096
bytes before reading. The live `/api/sessions` proxy does not read or forward its
request body at all.

## WOPI

Base path: `/wopi/{workspace}/{branch}/files/{file}`. In this executable the
authorized scope is always `synthetic/main/<opaque-file-id>`.
An opaque `access_token` query parameter is required; duplicate tokens are denied.

| Operation | Request | Behavior |
| --- | --- | --- |
| CheckFileInfo | GET base | Correct PascalCase WOPI fields, size, revision, user; read-only restrictions |
| GetFile | GET base`/contents` | Exact synthetic bytes |
| Lock | POST base, `X-WOPI-Override: LOCK`, `X-WOPI-Lock` | Acquire/reuse/replace with matching optional `X-WOPI-OldLock` |
| RefreshLock | POST base, `REFRESH_LOCK`, matching lock | Extend existing unexpired lock by 30 minutes |
| Unlock | POST base, `UNLOCK`, matching lock | Remove lock |
| GetLock | POST base, `GET_LOCK` | Return current unexpired lock |
| PutFile | POST base`/contents`, `PUT`, matching lock | At most 16 MiB; atomic conditional replacement |

Failures: 401 wrong scope/token/expired; 403 read-only mutation; 404 unknown file;
400 invalid/oversized lock; 409 lock/revision conflict; 413 oversized content;
501 unsupported operation. Lock conflict responses include `X-WOPI-Lock` and a
static recovery reason. Successful PutFile includes `X-WOPI-ItemVersion`.
Locks are bounded to 1024 characters. Stream reads count bytes even without
Content-Length; SQLite content is bounded by the same maximum.

No rename, delete, PutRelativeFile, user-info persistence, proof-key enforcement,
production host allowlisting, or live platform write capability is advertised.
WOPI credentials are bearer credentials, scoped and short-lived. Production
threat modelling and proof-key requirements remain part of gate E.
