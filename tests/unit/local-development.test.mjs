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

test('environment overlays bind distinct WOPI wrapper and operator origins without OAuth clients', () => {
    const overlay = name => parse(readFileSync(`manifests/environments/${name}.yaml`, 'utf8'));
    assert.equal(overlay('local').spec.entry, 'https://office.localtest.me');
    for (const name of ['local', 'feature', 'production']) {
        assert.equal(overlay(name).spec.wopi['editor-origin'], overlay(name).spec.entry);
        assert.equal(overlay(name).spec['hosted-backend'], undefined);
    }
    assert.equal(overlay('local').spec.wopi['operator-origin'], 'https://office-code.localtest.me');
});
