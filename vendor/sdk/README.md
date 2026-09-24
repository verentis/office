# Local SDK package

`verentis-sdk-0.2.0.tgz` is the explicit, unreleased SDK artifact used by this
Office integration. Include it with the source change set so a standalone
checkout, CI and the editor Dockerfile can resolve the same package.
`package-lock.json` pins its SHA-512 integrity. Its MIT license is included
inside the archive.

To refresh from an explicitly chosen SDK checkout with dependencies installed:

```sh
node scripts/use-local-sdk.mjs /absolute/path/to/sdk
```

Review the SDK source changes and archive/lockfile changes together. This does
not publish a package, fetch private source during CI, or establish a runtime
link to a sibling repository.
