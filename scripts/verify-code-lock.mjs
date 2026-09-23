import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(new URL('../deploy/code.lock.json', import.meta.url)));
const auth = await fetch('https://auth.docker.io/token?service=registry.docker.io&scope=repository:collabora/code:pull');
assert.equal(auth.status, 200);
const { token } = await auth.json();
const response = await fetch(`https://registry-1.docker.io/v2/collabora/code/manifests/${lock.tag}`, {
    headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json'
    }
});
assert.equal(response.status, 200);
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, lock.digest);
assert.equal(response.headers.get('docker-content-digest'), lock.digest);
const index = JSON.parse(bytes);
for (const [platform, digest] of Object.entries(lock.platforms)) {
    const [os, architecture] = platform.split('/');
    assert.equal(index.manifests.find(item => item.platform.os === os && item.platform.architecture === architecture)?.digest, digest);
}
console.log(`Verified CODE ${lock.tag} index bytes and all three platform digests against the public registry.`);
