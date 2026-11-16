import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const runner = fileURLToPath(new URL('../../scripts/run-platform-integration.mjs', import.meta.url));

async function platformFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'office-platform-integration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const harness = join(root, 'tests/playwright');
  await mkdir(join(harness, 'scripts'), { recursive: true });
  await writeFile(join(harness, 'scripts/run-warm-e2e.mjs'), `
    console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));
    process.exitCode = Number(process.env.OFFICE_RUNNER_TEST_EXIT_CODE ?? 0);
  `);
  return { root, harness };
}

function run(root, args, exitCode = 0) {
  return spawnSync(process.execPath, [runner, ...args], {
    cwd: tmpdir(),
    env: { ...process.env, VERENTIS_PLATFORM_ROOT: root, OFFICE_RUNNER_TEST_EXIT_CODE: String(exitCode) },
    encoding: 'utf8',
  });
}

test('Office integration targets the selected platform worktree and forwards browser arguments', async t => {
  const { root, harness } = await platformFixture(t);
  for (const scenario of ['app-office', 'app-office-operations']) {
    const result = run(root, [scenario, '--grep', 'real CODE']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      cwd: harness, args: [scenario, '--project=chromium', '--grep', 'real CODE'],
    });
  }
});

test('Office integration preserves a failing warm scenario exit code', async t => {
  const { root } = await platformFixture(t);
  assert.equal(run(root, ['app-office'], 7).status, 7);
});

test('an invalid explicit platform root fails without falling back to another checkout', async t => {
  const { root } = await platformFixture(t);
  const result = run(join(root, 'missing'), ['app-office']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Platform warm runner not found/);
});

test('Office integration rejects an unsupported scenario', async t => {
  const { root } = await platformFixture(t);
  const result = run(root, ['app-excalidraw']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Select app-office or app-office-operations/);
});
