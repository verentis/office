import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { render } from '../deploy/render.mjs';

const lock = JSON.parse(readFileSync('deploy/code.lock.json'));
const compose = parse(readFileSync('dev/compose.yaml', 'utf8'));
assert.equal(compose.services.code.image, `${lock.repository}:${lock.tag}@${lock.digest}`);
for (const file of ['deploy/editor.Dockerfile', 'deploy/backend.Dockerfile', 'dev/harness.Dockerfile']) {
    const source = readFileSync(file, 'utf8');
    for (const line of source.split('\n').filter(line => line.startsWith('FROM '))) assert.match(line, /@sha256:[a-f0-9]{64}( AS build)?$/);
    if (file.startsWith('deploy/')) {
        assert.doesNotMatch(source, /COPY\s+\.\s|tests\/|harness/i);
        assert.match(source, /USER /);
    }
}
mkdirSync('artifacts/deploy', { recursive: true });
for (const region of ['eu-test', 'us-test']) {
    const config = { region, dataRegion: region, parentOrigin: 'https://workspace.example.invalid', editorImage: `example.invalid/office-editor@sha256:${'1'.repeat(64)}`, backendImage: `example.invalid/office-backend@sha256:${'2'.repeat(64)}` };
    const result = render(config);
    assert.equal(result.services.editor.environment.NUXT_PUBLIC_SYNTHETIC_ONLY, 'false');
    assert.doesNotMatch(JSON.stringify(result), /harness|\/test|storage.ssl.ssl_verification/);
    assert.throws(() => render({ ...config, dataRegion: 'other' }));
    assert.throws(() => render({ ...config, backendImage: 'office:latest' }));
    const path = `artifacts/deploy/${region}.json`;
    writeFileSync(path, JSON.stringify(result));
    execFileSync('docker', ['compose', '-f', path, 'config', '--quiet'], { stdio: 'inherit' });
}
execFileSync('docker', ['compose', '-f', 'dev/compose.yaml', 'config', '--quiet'], { stdio: 'inherit' });
console.log('Deployment rendering, region, immutable image and source exclusion checks passed (not a deployment).');
