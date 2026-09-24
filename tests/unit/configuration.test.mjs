import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { render } from '../../deploy/render.mjs';

test('deployment rejects omitted or non-string processing region', () => {
    for (const config of [{}, { region: undefined, dataRegion: undefined }, { region: null, dataRegion: null }]) {
        assert.throws(() => render(config), /processing\/data region/);
    }
});

test('local SDK is integrity-pinned and available to standalone checkout and Docker builds', () => {
    const editor = JSON.parse(readFileSync('apps/editor/package.json', 'utf8'));
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    const archive = 'vendor/sdk/verentis-sdk-0.2.0.tgz';
    assert.equal(editor.dependencies['@verentis/sdk'], `file:../../${archive}`);
    const dependency = lock.packages['node_modules/@verentis/sdk'];
    assert.equal(dependency.resolved, `file:${archive}`);
    assert.equal(dependency.integrity, `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`);
    const dockerfile = readFileSync('deploy/editor.Dockerfile', 'utf8');
    assert.ok(dockerfile.indexOf('COPY vendor/sdk/ vendor/sdk/') >= 0);
    assert.ok(dockerfile.indexOf('COPY vendor/sdk/ vendor/sdk/') < dockerfile.indexOf('RUN npm ci'));
});

test('checks and release preparation remain secret-free and do not publish/import/deploy', () => {
    for (const file of ['checks.yml', 'prepare-release.yml']) {
        const text = readFileSync(`.github/workflows/${file}`, 'utf8');
        const workflow = parse(text);
        assert.deepEqual(workflow.permissions, { contents: 'read' });
        assert.doesNotMatch(text, /pull_request_target|secrets\.|docker push|verentis publish|az login/);
        for (const job of Object.values(workflow.jobs)) {
            assert.equal(job.permissions, undefined);
            for (const step of job.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
        }
    }
});
test('production project graph excludes harness and preserves repository license', () => {
    const backend = readFileSync('services/backend/Office.Backend.csproj', 'utf8');
    assert.match(backend, /\.\.\/wopi\/Office.Wopi.csproj/);
    assert.doesNotMatch(backend, /tests|harness/i);
    assert.match(backend, /Microsoft\.Data\.Sqlite" Version="10\.0\.3"/);
    assert.doesNotMatch(readFileSync('services/wopi/Office.Wopi.csproj', 'utf8'), /tests|harness|Sqlite/i);
    assert.match(readFileSync('LICENSE', 'utf8'), /Apache License/);
});
