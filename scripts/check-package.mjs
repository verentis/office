import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { parse } from 'yaml';

const manifests = readdirSync('manifests').filter(file => file.endsWith('.yaml'));
assert.deepEqual(manifests, ['office.app.yaml']);
const manifest = parse(readFileSync('manifests/office.app.yaml', 'utf8'));
const marketplace = manifest.marketplace;
assert.equal(marketplace.readme, './marketplace/README.md');
assert.ok(marketplace.logo);
assert.ok(marketplace.hero.source);
assert.ok(marketplace.hero.alt.trim());
assert.deepEqual(marketplace.images.map(image => image.source), [
    './marketplace/calc.png',
    './marketplace/writer.png',
    './marketplace/impress.png',
]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = source => {
    const root = resolve('manifests');
    const path = resolve(root, source);
    assert.ok(!relative(root, path).startsWith('..'), 'Catalog sources must stay inside manifests');
    return readFileSync(path);
};
const screenshotHashes = marketplace.images.map(image => {
    assert.ok(image.alt.trim());
    assert.ok(image.caption.trim());
    const bytes = sourceBytes(image.source);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Editor captures must be PNGs');
    assert.ok(bytes.readUInt32BE(16) >= 1000, 'Editor captures must remain legible');
    assert.ok(bytes.readUInt32BE(20) >= 600, 'Editor captures must show more than a toolbar');
    return sha256(bytes);
});
assert.equal(new Set(screenshotHashes).size, 3, 'Office must have three distinct editor captures');
const listing = sourceBytes(marketplace.readme).toString('utf8');
for (const text of ['## Before you install', '## Important limits', 'Collabora', 'consent', 'synthetic']) {
    assert.ok(listing.includes(text), `Installer copy must include ${text}`);
}
const assertIdentity = metadata => {
    assert.equal(metadata['package-id'], undefined);
    assert.equal(metadata['display-name'], undefined);
    assert.equal(metadata.id, 'libre-office');
    assert.equal(metadata.name, 'Libre Office');
};
assertIdentity(manifest.metadata);
assert.ok(manifest.spec['mime-types'].length > 0);
assert.deepEqual(manifest.spec.permissions, []);
assert.deepEqual(manifest.spec.capabilities, ['wopi']);
assert.equal(manifest.metadata.labels['integration-status'], 'consent-required');
assert.equal(manifest.spec['hosted-backend'], undefined);
assert.ok(manifest.spec.wopi.files.length > 0);
assert.deepEqual(manifest.spec.wopi.operations, ['rename', 'delete']);
const local = parse(readFileSync('manifests/environments/local.yaml', 'utf8'));
assert.equal(local.metadata.name, 'Libre Office');
assert.equal(local.metadata.labels['integration-status'], 'local-preview');
const production = parse(readFileSync('manifests/environments/production.yaml', 'utf8'));
assert.equal(production.metadata.name, 'Libre Office');
assert.equal(production.metadata.labels['integration-status'], 'production');
assert.equal(production.spec.entry, 'https://office.apps.verentis.io');
assert.equal(production.spec.wopi['operator-origin'], 'https://office-code.apps.verentis.io');
// Feature hosts are publish-time parameters; the shared validation workflow validates this overlay with sample values.
const feature = parse(readFileSync('manifests/environments/feature.yaml', 'utf8'));
assert.equal(feature.spec.entry, 'https://${param:app-host}');
assert.equal(feature.spec.wopi['editor-origin'], feature.spec.entry);
assert.equal(feature.spec.wopi['operator-origin'], 'https://office-code${param:host-suffix}.${param:apps-domain}');
assert.deepEqual({ ...feature, spec: { ...feature.spec, entry: production.spec.entry, wopi: production.spec.wopi } }, production,
    'The feature overlay must differ from production only in its hosts');
assert.deepEqual(production.spec.capabilities, ['wopi']);
assert.equal(production.spec['hosted-backend'], undefined);
assert.equal(production.spec.wopi['editor-origin'], production.spec.entry);
assert.deepEqual(production.spec.permissions, []);
execFileSync(process.execPath, ['scripts/sync-formats.mjs', '--check'], { stdio: 'inherit' });
assert.deepEqual(local.spec.permissions, []);
mkdirSync('artifacts/packages', { recursive: true });
for (const env of ['base', 'local', 'production']) {
    const overlayArgs = env === 'base' ? [] : ['--env', env];
    execFileSync('node_modules/.bin/verentis', ['validate', 'manifests', ...overlayArgs], { stdio: 'inherit' });
    const output = execFileSync('node_modules/.bin/verentis',
        ['pack', 'manifests', ...overlayArgs, '--no-sign', '--out', `artifacts/packages/${env}`],
        { encoding: 'utf8' });
    process.stdout.write(output);
    assert.ok(output.includes(`Packed verentis/libre-office@${manifest.metadata.version} (Application)`));
    const path = output.match(/^\s+(.+\.vpkg)$/m)?.[1].trim();
    assert.ok(path, 'CLI must report the packed artifact path');
    const packed = parse(execFileSync('tar', ['-xOzf', path, 'manifest.yaml'], { encoding: 'utf8' }));
    const metadata = parse(execFileSync('tar', ['-xOzf', path, '.verentis/package.yaml'], { encoding: 'utf8' }));
    assertIdentity(packed.metadata);
    assert.equal(metadata.id, 'libre-office');
    assert.equal(metadata.publisher, 'verentis');
    assert.equal(metadata.name, 'Libre Office');
    const selected = env === 'local' ? local : env === 'production' ? production : manifest;
    assert.equal(packed.spec.entry, selected.spec.entry);
    assert.deepEqual(packed.spec.capabilities, ['wopi']);
    assert.deepEqual(packed.spec.permissions, []);
    assert.equal(packed.spec['hosted-backend'], undefined);
    assert.deepEqual(packed.spec.wopi, { ...manifest.spec.wopi, ...selected.spec.wopi });
    // The CLI inlines icons at pack time: every icon becomes "#<sha256 prefix>" of an SVG in the packed icons map.
    const withoutIcons = list => list.map(({ icon, ...rest }) => rest);
    assert.deepEqual(withoutIcons(packed.spec['mime-types']), withoutIcons(selected.spec['mime-types']));
    for (const { icon } of packed.spec['mime-types']) {
        if (icon !== undefined) assert.ok(packed.icons?.[icon.replace(/^#/, '')], `mime-type icon ${icon} must resolve to an inlined SVG`);
    }
    const catalog = JSON.parse(execFileSync('tar', ['-xOzf', path, 'catalog/index.json'], { encoding: 'utf8' }));
    assert.equal(catalog.schemaVersion, 1);
    assert.equal(catalog.readme.source, 'marketplace/README.md');
    assert.equal(catalog.images.length, 3);
    assert.equal(catalog.hero.alt, marketplace.hero.alt);
    for (const [index, image] of catalog.images.entries()) {
        assert.equal(image.alt, marketplace.images[index].alt);
        assert.equal(image.caption, marketplace.images[index].caption);
        assert.equal(image.sha256, screenshotHashes[index]);
        assert.equal(image.mediaType, 'image/png');
    }
    for (const entry of [catalog.logo, catalog.hero, catalog.readme, ...catalog.images]) {
        const bytes = execFileSync('tar', ['-xOzf', path, entry.path], { maxBuffer: 6 * 1024 * 1024 });
        assert.equal(bytes.length, entry.size);
        assert.equal(sha256(bytes), entry.sha256);
        assert.deepEqual(bytes, sourceBytes(entry.source), `Packaged catalog bytes must match ${entry.source}`);
    }
}
