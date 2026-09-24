import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const sdk = process.argv[2];
if (!sdk) throw new Error('Usage: node scripts/use-local-sdk.mjs /absolute/path/to/sdk');
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(root, 'vendor/sdk');
await mkdir(destination, { recursive: true });
for (const [cwd, args] of [
    [resolve(sdk), ['run', 'build']],
    [resolve(sdk), ['pack', '--pack-destination', destination]],
    [resolve(root, 'apps/editor'), ['install', '--save-exact', 'file:../../vendor/sdk/verentis-sdk-0.2.0.tgz']],
]) {
    const result = spawnSync('npm', args, { cwd, stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
}
