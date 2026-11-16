import { execFileSync } from 'node:child_process';
import { createPrivateKey, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function validateProofKey(pem) {
    try {
        if (typeof pem !== 'string' ||
            !/^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\r?\n[A-Za-z0-9+/=\r\n]+-----END \1-----\s*$/.test(pem))
            throw new Error();
        const key = createPrivateKey(pem);
        if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048)
            throw new Error();
        return key.export({ format: 'der', type: 'pkcs1' });
    } catch {
        throw new Error('CODE_PROOF_KEY must be an unencrypted RSA private PEM key with at least 2048 bits.');
    }
}

function kubectl(args, input) {
    const env = { ...process.env };
    delete env.CODE_PROOF_KEY;
    return execFileSync('kubectl', args, {
        encoding: 'utf8', input, env, timeout: 30_000,
        stdio: ['pipe', 'pipe', 'pipe']
    });
}

export function provisionCodeProof(pem, namespace, run = kubectl) {
    const desired = validateProofKey(pem);
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(namespace ?? ''))
        throw new Error('Supply a valid target Kubernetes namespace.');
    const read = () => {
        try {
            const output = run(['get', 'secret', 'office-code-proof', '-n', namespace, '--ignore-not-found', '-o', 'json']);
            if (!output.trim()) return null;
            const secret = JSON.parse(output);
            const encoded = secret.data?.proof_key;
            if (typeof encoded !== 'string' || !encoded ||
                !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
                throw new Error();
            return validateProofKey(Buffer.from(encoded, 'base64').toString('utf8'));
        } catch {
            throw new Error('Cannot safely read office-code-proof; check cluster access and its RSA proof_key. No key was replaced.');
        }
    };
    const assertSame = existing => {
        if (existing.length !== desired.length || !timingSafeEqual(existing, desired))
            throw new Error('office-code-proof differs from CODE_PROOF_KEY. Drain CODE sessions and follow the explicit rotation procedure; deployment never replaces a key.');
    };
    const existing = read();
    if (existing !== null) {
        assertSame(existing);
        return 'preserved';
    }
    const secret = {
        apiVersion: 'v1', kind: 'Secret', type: 'Opaque',
        metadata: { name: 'office-code-proof', namespace },
        data: { proof_key: Buffer.from(pem).toString('base64') }
    };
    let created = true;
    try {
        run(['create', '-f', '-', '-n', namespace], JSON.stringify(secret));
    } catch {
        // Another deployment may have created the Secret after our read.
        created = false;
    }
    const current = read();
    if (current === null)
        throw new Error('Cannot create or verify office-code-proof; check Secret create/read permissions and retry. No existing key was replaced.');
    assertSame(current);
    return created ? 'created' : 'preserved';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        if (process.argv.length !== 3) throw new Error('Usage: node scripts/provision-code-proof.mjs <namespace>');
        const result = provisionCodeProof(process.env.CODE_PROOF_KEY, process.argv[2]);
        console.log(`CODE proof Secret ${result}; private material was not logged.`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
