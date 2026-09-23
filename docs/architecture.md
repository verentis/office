# ADR: prerequisite-gated Office

## Decision

Office owns a Nuxt 4/Vue/TypeScript wrapper and .NET 10 session boundary.
The public `@verentis/sdk` **0.1.1** `Bridge` performs the parent handshake.
A capture-phase guard enforces the configured parent origin **and** parent window
before that SDK sees host messages. CODE child messages use a separate source and
origin check. No SDK file or credential API is called.

`services/backend` has no file-store implementation, harness reference, test
identity handler, configurable admission switch or live adapter. `/sessions`
always returns 503 and `/wopi/**` always denies. Deployment cannot enable live
admission by setting an environment flag. This is intentional partial delivery.

`services/wopi` contains the reusable protocol and discovery reader. Only
`tests/harness` composes them with a SQLite implementation. Its fixed identity,
fixture creation API, database and fixture bytes never enter the deployable
backend image. The test identity is **not authentication**. Bind the dev proxy
to loopback; never route the harness onto a public or shared network.

## Harness transaction boundary

One backend and one CODE instance; no multi-replica or production state claim.
SQLite WAL transactions durably store:

- synthetic file bytes and monotonically increasing revisions;
- immutable previous versions;
- SHA-256 hashes of random 256-bit session credentials, workspace/branch/file,
  user, read/write permission, admitted revision and absolute expiry;
- exact opaque WOPI locks and a 30-minute lock expiry.

Write admission rechecks authorization inside an immediate write transaction.
A lock is necessary but insufficient: compare the authorized request's admitted
revision with the authoritative head. Replace the bytes, append history and
advance the session revision in the same transaction. Conflicts do none of these.
Expiry is never renewed implicitly. Reopening issues a distinct bounded session.
No credentials are stored in browser local/session storage.

## Browser and discovery boundaries

Discovery is fetched only from the operator-configured endpoint, with redirects
disabled, a timeout, bounded XML, prohibited DTDs and no external resolver.
Only six synthetic fixture extensions and the requested edit/view action are
accepted. The browser independently checks exact CODE and WOPI origins,
the expected file-scoped WOPISrc, supported format, action path and expiry.
A hidden POST form transfers only a harness WOPI credential to the CODE child.
No Verentis token is forwarded to Nuxt's proxy, WOPI, CODE or storage.

CODE save notifications are not durable acknowledgements. Dirty state is
conservative and never cleared by a load event, save request or CODE notification.
Browser beforeunload is best effort; the host's navigation veto is **unproved**.

## Not addressed by this decision

Gates B–E in [compatibility](compatibility.md) require separate platform changes
and real Verentis acceptance. No synthetic test establishes app-audience consent,
revocation, authoritative stable-ID routing, conditional platform upload,
production collaboration, regional infrastructure ownership or drain correctness.
