import assert from 'node:assert/strict';
import { generateKeyPairSync, createPrivateKey } from 'node:crypto';
import test from 'node:test';
import { provisionCodeProof, validateProofKey } from '../../scripts/provision-code-proof.mjs';

const key = () => generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
});
const first = key();
const second = key();
const namespace = 'verentis-apps';
const stored = pem => JSON.stringify({ data: { proof_key: Buffer.from(pem).toString('base64') } });
const stub = responses => {
    const calls = [];
    return {
        calls,
        run(args, input) {
            calls.push({ args, input });
            const response = responses.shift();
            if (response instanceof Error) throw response;
            assert.notEqual(response, undefined, 'unexpected kubectl invocation');
            return response;
        }
    };
};

test('invalid, missing, public, weak and non-RSA proof keys fail before cluster access', () => {
    const ec = generateKeyPairSync('ec', {
        namedCurve: 'prime256v1', privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' }
    }).privateKey;
    const weak = generateKeyPairSync('rsa', {
        modulusLength: 1024, privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' }
    }).privateKey;
    const encrypted = createPrivateKey(first.privateKey).export({
        format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: 'test-only'
    });
    for (const pem of [undefined, '', 'random-secret', first.publicKey, ec, weak, encrypted,
        first.privateKey + second.privateKey, first.privateKey.replace('M', '!')]) {
        const client = stub([]);
        assert.throws(() => provisionCodeProof(pem, namespace, client.run), /RSA private PEM/);
        assert.equal(client.calls.length, 0);
    }
    assert.throws(() => provisionCodeProof(first.privateKey, 'bad/namespace', stub([]).run), /namespace/);
});

test('existing identical key is preserved without writes, including alternate PEM encoding', () => {
    const pkcs8 = createPrivateKey(first.privateKey).export({ format: 'pem', type: 'pkcs8' });
    assert.deepEqual(validateProofKey(pkcs8), validateProofKey(first.privateKey));
    for (const pem of [first.privateKey, pkcs8]) {
        const client = stub([stored(pem)]);
        assert.equal(provisionCodeProof(first.privateKey, namespace, client.run), 'preserved');
        assert.deepEqual(client.calls, [{
            args: ['get', 'secret', 'office-code-proof', '-n', namespace, '--ignore-not-found', '-o', 'json'],
            input: undefined
        }]);
    }
});

test('existing different key requires drained rotation and is never overwritten', () => {
    const client = stub([stored(second.privateKey)]);
    assert.throws(() => provisionCodeProof(first.privateKey, namespace, client.run), /Drain CODE sessions/);
    assert.equal(client.calls.length, 1);
});

test('missing Secret is created using stdin and verified without key arguments', () => {
    const client = stub(['', 'secret/office-code-proof created', stored(first.privateKey)]);
    assert.equal(provisionCodeProof(first.privateKey, namespace, client.run), 'created');
    assert.equal(client.calls.length, 3);
    assert.deepEqual(client.calls[1].args, ['create', '-f', '-', '-n', namespace]);
    assert.deepEqual(JSON.parse(client.calls[1].input), {
        apiVersion: 'v1', kind: 'Secret', type: 'Opaque',
        metadata: { name: 'office-code-proof', namespace },
        data: { proof_key: Buffer.from(first.privateKey).toString('base64') }
    });
    for (const call of client.calls) {
        assert.ok(!JSON.stringify(call.args).includes(first.privateKey));
        assert.ok(!JSON.stringify(call.args).includes(Buffer.from(first.privateKey).toString('base64')));
    }
});

test('concurrent creation preserves an equal key and refuses a different one', () => {
    const equal = stub(['', new Error('AlreadyExists'), stored(first.privateKey)]);
    assert.equal(provisionCodeProof(first.privateKey, namespace, equal.run), 'preserved');
    const different = stub(['', new Error('AlreadyExists'), stored(second.privateKey)]);
    assert.throws(() => provisionCodeProof(first.privateKey, namespace, different.run), /Drain CODE sessions/);
    const replaced = stub(['', 'created', stored(second.privateKey)]);
    assert.throws(() => provisionCodeProof(first.privateKey, namespace, replaced.run), /Drain CODE sessions/);
});

test('read/create failures and malformed existing Secrets fail closed without leaking key material', () => {
    for (const responses of [
        [new Error(first.privateKey)],
        ['not-json'],
        ['{}'],
        [JSON.stringify({ data: { proof_key: '!!!' } })],
        [stored('not-rsa')],
        ['', new Error(first.privateKey), ''],
        ['', 'created', new Error(first.privateKey)]
    ]) {
        const client = stub(responses);
        assert.throws(() => provisionCodeProof(first.privateKey, namespace, client.run), error => {
            assert.match(error.message, /Cannot/);
            assert.ok(!error.message.includes('PRIVATE KEY'));
            assert.equal(error.cause, undefined);
            return true;
        });
    }
});
