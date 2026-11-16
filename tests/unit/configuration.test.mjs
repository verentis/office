import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { render } from '../../deploy/render.mjs';

test('deployment rejects omitted or non-string processing region', () => {
    for (const config of [{}, { region: undefined, dataRegion: undefined }, { region: null, dataRegion: null }]) {
        assert.throws(() => render(config), /processing\/data region/);
    }
});

test('published SDK is exact-versioned and integrity-pinned for standalone and Docker builds', () => {
    const editor = JSON.parse(readFileSync('apps/editor/package.json', 'utf8'));
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    assert.equal(editor.dependencies['@verentis/sdk'], '1.0.0');
    const dependency = lock.packages['node_modules/@verentis/sdk'];
    assert.equal(dependency.version, '1.0.0');
    assert.equal(dependency.resolved, 'https://registry.npmjs.org/@verentis/sdk/-/sdk-1.0.0.tgz');
    assert.match(dependency.integrity, /^sha512-/);
    const dockerfile = readFileSync('deploy/editor.Dockerfile', 'utf8');
    assert.doesNotMatch(dockerfile, /vendor\/sdk/);
});

test('checks remain secret-free and do not publish/import/deploy', () => {
    const text = readFileSync('.github/workflows/checks.yml', 'utf8');
    const workflow = parse(text);
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.doesNotMatch(text, /pull_request_target|secrets\.|docker push|verentis publish|az login/);
    for (const job of Object.values(workflow.jobs)) {
        assert.equal(job.permissions, undefined);
        if (job.uses) assert.equal(job.uses, 'verentis/.github/.github/workflows/validate-verentis-package.yml@main');
        for (const step of job.steps ?? []) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
    }
});

test('CI installs Chromium before running browser-based framing checks', () => {
    const workflow = parse(readFileSync('.github/workflows/checks.yml', 'utf8'));
    const steps = workflow.jobs.check.steps;
    const framing = steps.findIndex(step => step.run?.includes('npm run check:framing'));
    assert.ok(framing >= 0, 'framing checks must remain enabled');
    const dependencies = steps.findIndex(step => step.run?.startsWith('npm ci'));
    const browser = steps.findIndex(step => step.run === 'npx --no-install playwright install --with-deps chromium');
    assert.ok(dependencies >= 0 && browser > dependencies && browser < framing,
        'install the locked Playwright browser and system dependencies before framing checks');
    assert.equal(workflow.name, 'Tests');
});

test('Office contains no WOPI persistence or backend project authority', () => {
    assert.equal(existsSync('services/backend/Office.Backend.csproj'), false);
    assert.equal(existsSync('services/wopi/Office.Wopi.csproj'), false);
    assert.equal(existsSync('Office.slnx'), false);
    assert.match(readFileSync('LICENSE', 'utf8'), /Apache License/);
});

test('Office requests explicit signed rename/delete consent without ordinary OAuth scopes', () => {
    const manifest = parse(readFileSync('manifests/office.app.yaml', 'utf8'));
    assert.deepEqual(manifest.spec.wopi.operations, ['rename', 'delete']);
    assert.deepEqual(manifest.spec.permissions, []);
    for (const environment of ['local', 'feature', 'production']) {
        const overlay = parse(readFileSync(`manifests/environments/${environment}.yaml`, 'utf8'));
        assert.deepEqual({ ...manifest.spec.wopi, ...overlay.spec.wopi }.operations, ['rename', 'delete']);
        assert.deepEqual(overlay.spec.permissions, []);
        assert.equal(overlay.spec['hosted-backend'], undefined);
    }
});
