# Platform-owned WOPI architecture

Office contains a Nuxt/Vue wrapper and a pinned Collabora CODE deployment.
Verentis.Collaboration alone owns sessions, document-scoped credentials,
discovery/proof verification, locks, mutation receipts and persistence.
Node remains the authoritative file store. There is no Office database,
client secret, signing key, WOPI host or platform-file backend.

## Admission and consent

A verified signed application declares `capabilities: [wopi]`, exact wrapper
and operator origins, supported formats/actions and bounded session/file limits.
Workspace administrators review document-processing consent for that candidate.
Installation establishes revocable editor trust, not blanket document access.
Every launch and operation still checks current user/document authorization.
First- and third-party editors use the same contract; no Office-name exception
or per-editor OAuth-client registration is used.

Ordinary applications that call platform APIs retain their existing OAuth
authentication and backend delegation. A WOPI declaration or package signature
is not a replacement credential for those APIs.

## Browser boundaries

The platform parent obtains a single-use embed ticket before navigating the
wrapper. Server-authorized CSP restricts ancestors to that exact workspace.
The SDK pins the parent window/origin and correlates requests with the host
session. The parent chooses launch identity from its current installation and
file context; the child cannot substitute it.

Only scoped WOPI launch data reaches the wrapper. It validates the action,
CODE/platform origins, stable source path, current document context and absolute
expiry, then form-POSTs the token to CODE. The CODE proxy obtains platform framing
authorization before admitting wrapper and workspace ancestors. It never handles
WOPI callbacks. Credentials are not persisted in browser storage.

## Save and recovery

The wrapper consumes SDK-owned exact-origin, host-document binding and durable
receipt validation. These are shared platform-facing contracts, independent of
the editor provider. CODE action URL checks, supported formats, postMessage
translation and internal coauthoring remain in the Libre Office adapter.
This shared foundation does not imply support for a Microsoft Office provider;
that provider requires its own admitted WOPI profile and runtime verification.

CODE messages have a separate exact child-window/origin boundary. Modification
messages latch dirty state in both wrapper and host; route/unload guards preserve
unverified edits. Explicit saves receive platform checkpoints and pass their
correlation to CODE. Only a matching durable platform receipt with no later edits
clears dirty state. Expiry, revocation, conflicts and unavailable status never
silently acknowledge a save. Reopening goes through fresh platform admission.

See [browser/API contract](api.md) and [verification](verification.md). Real warm
Collabora open/edit/save/reopen/coauthor/revoke evidence is mandatory; isolated
unit tests and mock framing responses are not that evidence.
