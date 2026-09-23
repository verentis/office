import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

const manifests = readdirSync('manifests').filter(file => file.endsWith('.yaml'));
assert.deepEqual(manifests, ['office.app.yaml']);
const manifest = parse(readFileSync('manifests/office.app.yaml', 'utf8'));
assert.deepEqual(manifest.spec['mime-types'], []);
assert.deepEqual(manifest.spec.permissions, []);
assert.deepEqual(manifest.spec.capabilities, []);
assert.equal(manifest.metadata.labels['integration-status'], 'disabled');
mkdirSync('artifacts/packages', { recursive: true });
for (const env of ['local', 'production']) {
    execFileSync('node_modules/.bin/verentis', ['validate', 'manifests', '--env', env], { stdio: 'inherit' });
    execFileSync('node_modules/.bin/verentis', ['pack', 'manifests', '--env', env, '--no-sign', '--out', `artifacts/packages/${env}`], { stdio: 'inherit' });
}
