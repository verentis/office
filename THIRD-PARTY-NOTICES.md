# Third-party inventory

The existing [LICENSE](LICENSE) remains Apache-2.0 for Office-owned work.
It does not relicense dependencies, CODE, LibreOffice, container distributions
or any trademark. This is an inventory, not a final redistributed notice bundle
or a legal determination.

| Component | Version/source | Upstream rights / review |
| --- | --- | --- |
| Verentis SDK | npm `@verentis/sdk@0.1.1` | MIT (published package metadata) |
| Verentis CLI | npm `@verentis/cli@0.2.18`, build/validation only | MIT (published package metadata) |
| Nuxt / Vue | npm locks, Nuxt 4.5.2 / Vue 3.5.43 | MIT |
| TypeScript / Playwright | npm locks, build/test only | Apache-2.0 |
| .NET / ASP.NET Core | .NET 10 image digests in Dockerfiles | MIT components; image distribution packages have their own licenses |
| Microsoft.Data.Sqlite / SQLitePCLRaw | NuGet project declarations | MIT / Apache-2.0 wrapper components; SQLite public-domain dedication |
| Caddy | pinned 2.11.2 container | Apache-2.0 plus Go/dependency/image notices |
| Collabora CODE / LibreOffice | `deploy/code.lock.json` | Primarily MPL-2.0 and other component-specific licenses; keep source/notice obligations and distribution terms |
| Container base systems | pinned Node/.NET/Caddy/CODE images | Multiple distribution licenses; inventory final image SBOMs |
| Synthetic fixtures | `tests/fixtures/generate.py` | Original minimal documents authored for this repository, no customer or upstream document content |

Upstream source locations:

- https://github.com/verentis/sdk
- https://github.com/verentis/cli
- https://github.com/nuxt/nuxt and https://github.com/vuejs/core
- https://github.com/dotnet/aspnetcore and https://github.com/dotnet/efcore
- https://github.com/ericsink/SQLitePCL.raw and https://sqlite.org/copyright.html
- https://github.com/caddyserver/caddy
- https://github.com/CollaboraOnline/online and https://www.libreoffice.org/about-us/licenses/
- https://www.collaboraonline.com/code/

No upstream executable or document was copied into Office source. Docker pulls
and npm/NuGet caches are development artifacts, not relicensed source.
The release owner must generate exact transitive notices and source offers
where applicable for the chosen distribution; don't describe this file as
completed legal clearance. Collabora, LibreOffice and Verentis marks remain
their owners' marks.
