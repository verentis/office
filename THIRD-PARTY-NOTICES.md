# Third-party inventory

The existing [LICENSE](LICENSE) remains Apache-2.0 for Office-owned work.
It does not relicense dependencies, CODE, LibreOffice, container distributions
or any trademark. This is an inventory, not a final redistributed notice bundle
or a legal determination.

| Component | Version/source | Upstream rights / review |
| --- | --- | --- |
| Verentis SDK | npm `@verentis/sdk@0.2.6` | MIT (published package metadata and included `LICENSE`) |
| Verentis CLI | npm `@verentis/cli@0.2.18`, build/validation only | MIT (published package metadata) |
| Nuxt / Vue | npm locks, Nuxt 4.5.2 / Vue 3.5.43 | MIT |
| TypeScript / Playwright | npm locks, build/test only | Apache-2.0 |
| Collabora CODE / LibreOffice | `deploy/code.lock.json` | Primarily MPL-2.0 and other component-specific licenses; keep source/notice obligations and distribution terms |
| Container base systems | pinned Node/CODE images | Multiple distribution licenses; inventory final image SBOMs |
| Synthetic fixtures | `tests/fixtures/generate.py` | Original minimal documents authored for this repository, no customer or upstream document content |
| Marketplace samples and captures | `manifests/marketplace/samples/` and `manifests/marketplace/{calc,writer,impress}.png` | Original synthetic documents and actual captures of the pinned CODE editor; interface artwork and marks retain upstream rights. Capture provenance and limitations are recorded in `manifests/marketplace/ASSET-NOTICES.md`. |

Upstream source locations:

- https://github.com/verentis/sdk
- https://github.com/verentis/cli
- https://github.com/nuxt/nuxt and https://github.com/vuejs/core
- https://github.com/CollaboraOnline/online and https://www.libreoffice.org/about-us/licenses/
- https://www.collaboraonline.com/code/

No CODE/LibreOffice executable or upstream document was copied into Office source.
The published SDK dependency retains its MIT license and npm lock integrity; it
is not relicensed as Office-owned work. Docker pulls and npm caches remain
development artifacts. Platform-owned Collaboration services,
storage and gateways have their own dependency inventories; the removed Office
.NET/SQLite backend and synthetic gateway are not distributed by this wrapper.
The release owner must generate exact transitive notices and source offers
where applicable for the chosen distribution; don't describe this file as
completed legal clearance. Collabora, LibreOffice and Verentis marks remain
their owners' marks.
