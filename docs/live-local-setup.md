# Local platform-owned Office

Use the normal platform Aspire topology with isolated local dependencies and
trusted TLS. Do not recreate existing Cosmos containers or shared volumes.
Keep CODE pinned by `deploy/code.lock.json`.

1. Install Office dependencies with `npm ci`. The lockfile pins the bundled SDK.
2. Start the platform topology, including Collaboration, Node, Security,
   Resource, Marketplace, wrapper and CODE. The wrapper's
   `NUXT_COLLABORATION_URL` points to Collaboration, while its public
   `wopiOrigin` is the gateway's HTTPS origin.
3. Pack the local Office manifest using an active publisher signing key and
   publish the exact signed candidate to the isolated local Marketplace.
   Never use a production registry or real customer files for acceptance tests.
4. Install it into the test workspace and review/approve WOPI document-processing
   consent. No hosted-backend registration or Office client ID/secret is needed.
5. Upload an original fixture and open it through the trusted workspace parent.
   Direct wrapper navigation without a platform-issued embed ticket is denied.
6. Edit, explicitly save, observe the matching durable revision receipt, then
   reopen in a fresh browser context. Test concurrent participants and revoke
   the installation while an editor is open.

An unsigned package from `npm run check:package` is only an offline artifact,
not a live-authorized install. Package signing keys never enter browser code or
packages. Collaboration workload credentials remain platform configuration.

## Formats

`apps/editor/shared/formats.json` drives browser validation, MIME bindings,
extension rules and the signed WOPI file declaration. `npm run sync:formats`
updates those declarations; `npm run check:package` detects drift. Discovery and
current permissions still decide the effective view/edit action.

Supported families include Word/Writer, Excel/Calc, PowerPoint/Impress,
text/tabular interchange, Draw/Visio/Publisher and legacy OpenOffice. Formats
marked view-only remain read-only. Plain text and Markdown have lower handler
priority. MIME registration is not a fidelity guarantee or a promise that macros
run. Access, OneNote, Base and Math formats are not implicitly claimed.

## Verification

Run `npm run check` and `npm run check:framing`. Start the platform's warm test
stack using its documented `warm:start -- --apps` command, then run Office's
`npm run test:integration`. Rebuild/restart changed services/assets first.
Only real CODE tests against platform-owned WOPI establish integration evidence.
The old standalone synthetic Office backend/harness is not part of this topology.
