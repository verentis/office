import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { runInNewContext } from 'node:vm';

test('Nuxt uses injected TLS and rejects incomplete certificate configuration', () => {
    const source = readFileSync('apps/editor/nuxt.config.ts', 'utf8')
        .replace("import process from 'node:process';", '').replace('export default ', '');
    const load = env => runInNewContext(source, { process: { env }, defineNuxtConfig: value => value });
    assert.equal(load({}).devServer.https, false);
    assert.ok(load({}).nitro.externals.inline.some(pattern => pattern.test('/apps/editor/shared/frame-policy.mjs')));
    assert.equal(load({ NUXT_HTTPS_CERT: '/cert', NUXT_HTTPS_KEY: '/key' }).devServer.https.cert, '/cert');
    assert.throws(() => load({ NUXT_HTTPS_CERT: '/cert' }), /Configure both/);
    assert.throws(() => load({ NUXT_HTTPS_KEY: '/key' }), /Configure both/);
});

test('Aspire and Compose overlays retain distinct synthetic launch addresses', () => {
    const overlay = name => parse(readFileSync(`manifests/environments/${name}.yaml`, 'utf8'));
    assert.equal(overlay('local').spec.entry, 'https://office.localtest.me');
    assert.equal(overlay('compose').spec.entry, 'https://office.localhost:8443');
    const compose = parse(readFileSync('dev/compose.yaml', 'utf8'));
    const lock = JSON.parse(readFileSync('deploy/code.lock.json', 'utf8'));
    assert.equal(compose.services.code.image, `${lock.repository}:${lock.tag}@${lock.digest}`);
    assert.equal(compose.services.harness.environment.EditorOrigin, overlay('compose').spec.entry);
    assert.equal(compose.services.editor.environment.NUXT_PUBLIC_SYNTHETIC_ONLY, 'true');
});
