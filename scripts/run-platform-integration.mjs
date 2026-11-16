import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platformRoot = resolve(repositoryRoot, process.env.VERENTIS_PLATFORM_ROOT ?? '../platform');
const harnessRoot = resolve(platformRoot, 'tests/playwright');
const runner = resolve(harnessRoot, 'scripts/run-warm-e2e.mjs');
const [scenario, ...args] = process.argv.slice(2);

if (!['app-office', 'app-office-operations'].includes(scenario)) {
  throw new Error('Select app-office or app-office-operations.');
}
if (!existsSync(runner)) {
  throw new Error(`Platform warm runner not found at ${runner}. Set VERENTIS_PLATFORM_ROOT to the intended checkout.`);
}

const result = spawnSync(process.execPath, [
  '--env-file-if-exists=.env', runner, scenario, '--project=chromium', ...args,
], { cwd: harnessRoot, env: process.env, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.signal) throw new Error(`Platform warm runner terminated with ${result.signal}.`);
if (result.status === null) throw new Error('Platform warm runner returned no exit status.');
process.exitCode = result.status;
