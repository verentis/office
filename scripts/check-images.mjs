import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const [backend, editor] = process.argv.slice(2);
if (!backend || !editor) throw new Error('Supply built backend and editor image names.');
for (const image of [backend, editor]) {
    const info = JSON.parse(execFileSync('docker', ['image', 'inspect', image]))[0];
    assert.ok(info.Config.User && !['0', 'root'].includes(info.Config.User));
    const files = execFileSync('docker', ['run', '--rm', '--network=none', '--entrypoint', 'sh', image, '-c', 'find /app -type f'], { encoding: 'utf8' });
    assert.doesNotMatch(files, /Office\.Harness|SyntheticStore|synthetic\.(docx|odt|xlsx|ods|pptx|odp)|\.sqlite/);
}
const container = execFileSync('docker', ['run', '-d', '-p', '127.0.0.1::8080', '-e', 'SyntheticOnly=true', backend], { encoding: 'utf8' }).trim();
try {
    const port = JSON.parse(execFileSync('docker', ['inspect', container]))[0].NetworkSettings.Ports['8080/tcp'][0].HostPort;
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
        try {
            ready = (await fetch(`${origin}/health`)).ok;
            if (ready) break;
        } catch { /* Wait for the actual backend process, not a fixed startup delay. */ }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready);
    const live = await fetch(`${origin}/sessions`, { method: 'POST' });
    assert.equal(live.status, 503);
    assert.equal((await live.json()).code, 'platform_prerequisites_missing');
    assert.equal((await fetch(`${origin}/test/sessions`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${origin}/wopi/synthetic/main/files/f?access_token=untrusted`)).status, 401);
} finally {
    execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
}
const wrapper = execFileSync('docker', ['run', '-d', '-p', '127.0.0.1::3000', editor], { encoding: 'utf8' }).trim();
try {
    const port = JSON.parse(execFileSync('docker', ['inspect', wrapper]))[0].NetworkSettings.Ports['3000/tcp'][0].HostPort;
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
        try {
            ready = (await fetch(origin)).ok;
            if (ready) break;
        } catch { /* The built wrapper must be responsive, not merely present on disk. */ }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready);
    assert.equal((await fetch(`${origin}/api/test/sessions`, { method: 'POST', headers: { Origin: origin } })).status, 404);
} finally {
    execFileSync('docker', ['rm', '-f', wrapper], { stdio: 'ignore' });
}
console.log('Built deployable images run as non-root, exclude test host/data and deny live/test admission even with synthetic flags.');
