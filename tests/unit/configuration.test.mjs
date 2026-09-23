import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import { render } from '../../deploy/render.mjs';

test('deployment rejects omitted or non-string processing region', () => {
    for (const config of [{}, { region: undefined, dataRegion: undefined }, { region: null, dataRegion: null }]) {
        assert.throws(() => render(config), /processing\/data region/);
    }
});

test('CI is immutable, secret-free and does not publish/import/deploy', () => {
    for (const file of readdirSync('.github/workflows')) {
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
    assert.doesNotMatch(backend, /tests|harness|Sqlite/i);
    assert.doesNotMatch(readFileSync('services/wopi/Office.Wopi.csproj', 'utf8'), /tests|harness|Sqlite/i);
    assert.match(readFileSync('LICENSE', 'utf8'), /Apache License/);
});
