import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { render } from '../deploy/render.mjs';

const lock = JSON.parse(readFileSync('deploy/code.lock.json'));
for (const file of ['deploy/editor.Dockerfile']) {
    const source = readFileSync(file, 'utf8');
    for (const line of source.split('\n').filter(line => line.startsWith('FROM '))) assert.match(line, /@sha256:[a-f0-9]{64}( AS build)?$/);
    if (file.startsWith('deploy/')) {
        assert.doesNotMatch(source, /COPY\s+\.\s|tests\/|harness/i);
        assert.match(source, /USER /);
    }
}
mkdirSync('artifacts/deploy', { recursive: true });
for (const region of ['eu-test', 'us-test']) {
    const config = {
        region, dataRegion: region, editorImage: `example.invalid/office-editor@sha256:${'1'.repeat(64)}`,
        platformOrigin: 'https://api.example.invalid', editorOrigin: 'https://office.example.invalid',
        codeOrigin: 'https://code.example.invalid', proofKeyFile: `${process.cwd()}/artifacts/code-proof/proof_key`
    };
    const result = render(config);
    assert.equal(result.services.code.image, `${lock.repository}:${lock.tag}@${lock.digest}`);
    assert.equal(result.services.editor.environment.NUXT_PUBLIC_WOPI_ORIGIN, config.platformOrigin);
    assert.equal(result.services.code.environment.aliasgroup1, `${config.platformOrigin}:443`);
    assert.deepEqual(Object.keys(result.services), ['editor', 'code']);
    assert.doesNotMatch(JSON.stringify(result), /harness|\/test|storage.ssl.ssl_verification/);
    assert.throws(() => render({ ...config, dataRegion: 'other' }));
    assert.throws(() => render({ ...config, editorImage: 'office:latest' }));
    assert.throws(() => render({ ...config, platformOrigin: 'http://api.example.invalid' }));
    assert.throws(() => render({ ...config, platformOrigin: 'https://api.example.invalid/path' }));
    const path = `artifacts/deploy/${region}.json`;
    writeFileSync(path, JSON.stringify(result));
    execFileSync('docker', ['compose', '-f', path, 'config', '--quiet'], { stdio: 'inherit' });
}
console.log('Deployment rendering, region, immutable image and source exclusion checks passed (not a deployment).');
