import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const [editor] = process.argv.slice(2);
if (!editor) throw new Error('Supply the built editor image name.');
for (const image of [editor]) {
    const info = JSON.parse(execFileSync('docker', ['image', 'inspect', image]))[0];
    assert.ok(info.Config.User && !['0', 'root'].includes(info.Config.User));
    const files = execFileSync('docker', ['run', '--rm', '--network=none', '--entrypoint', 'sh', image, '-c', 'find /app -type f'], { encoding: 'utf8' });
    assert.doesNotMatch(files, /Office\.(?:Harness|Backend)|SyntheticStore|synthetic\.(docx|odt|xlsx|ods|pptx|odp)|\.sqlite/);
}
const wrapper = execFileSync('docker', ['run', '-d', '-p', '127.0.0.1::3000', editor], { encoding: 'utf8' }).trim();
try {
    const port = JSON.parse(execFileSync('docker', ['inspect', wrapper]))[0].NetworkSettings.Ports['3000/tcp'][0].HostPort;
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
        try {
            ready = (await fetch(`${origin}/_ready`)).ok;
            if (ready) break;
        } catch { /* The built wrapper must be responsive, not merely present on disk. */ }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready);
    for (const [method, path] of [
        ['POST', '/api/test/sessions'], ['GET', '/api/sessions'], ['GET', '/api'], ['OPTIONS', '/api/']
    ]) {
        const response = await fetch(`${origin}${path}`, {
            method, headers: { Origin: origin, Accept: 'text/html' }
        });
        assert.equal(response.status, 404, `${method} ${path} must not fall through to the SPA`);
        assert.doesNotMatch(await response.text(), /id="__nuxt"/);
    }
} finally {
    execFileSync('docker', ['rm', '-f', wrapper], { stdio: 'ignore' });
}
console.log('Built wrapper runs as non-root, excludes retired WOPI authority/test data and has no test admission.');
