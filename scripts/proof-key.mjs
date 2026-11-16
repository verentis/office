import { generateKeyPairSync, createPrivateKey, createPublicKey, createHash, randomUUID } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function provisionProofKey(path, rotate = false, drained = false) {
    path = resolve(path);
    if (rotate && !drained) throw new Error('Drain CODE sessions before rotating: pass --drained after verifying the drain.');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (rotate && !existsSync(path)) throw new Error('Cannot rotate a missing proof key.');
    if (rotate || !existsSync(path)) {
        const pair = generateKeyPairSync('rsa', {
            modulusLength: 3072,
            privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
            publicKeyEncoding: { type: 'spki', format: 'pem' }
        });
        if (rotate) {
            const suffix = randomUUID();
            const next = `${path}.next-${suffix}`;
            try {
                writeFileSync(next, pair.privateKey, { flag: 'wx', mode: 0o600 });
                copyFileSync(path, `${path}.old-${suffix}`, constants.COPYFILE_EXCL);
                renameSync(next, path);
            } finally {
                rmSync(next, { force: true });
            }
        } else {
            writeFileSync(path, pair.privateKey, { flag: 'wx', mode: 0o600 });
        }
    }
    const key = createPrivateKey(readFileSync(path));
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048)
        throw new Error('CODE requires a private RSA proof key with at least 2048 bits.');
    return createHash('sha256').update(createPublicKey(key).export({ type: 'spki', format: 'der' })).digest('hex');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [operation, path, flag] = process.argv.slice(2);
    if (!['init', 'rotate'].includes(operation) || !path || (flag && flag !== '--drained'))
        throw new Error('Usage: node scripts/proof-key.mjs init|rotate <operator-key-path> [--drained]');
    console.log(`CODE public-key SHA-256: ${provisionProofKey(path, operation === 'rotate', flag === '--drained')}`);
}
