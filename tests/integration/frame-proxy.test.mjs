import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';

const listen = handler => new Promise(resolve => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
});
const port = server => server.address().port;

test('built CODE proxy substitutes only authorized ancestors on document POST', async () => {
    const backend = await listen((_request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ parentOrigin: 'https://customer.example' }));
    });
    const code = await listen((request, response) => {
        response.setHeader('Content-Type', request.url.includes('cool.html') ? 'text/html' : 'text/javascript');
        response.setHeader('Content-Security-Policy',
            "default-src 'self'; frame-ancestors office-wopi.apps.verentis.dev:*; connect-src 'self'");
        response.end(request.url.includes('cool.html') ? '<html>CODE</html>' : 'console.log(1)');
    });
    const reserved = await listen((_request, response) => response.end());
    const proxyPort = port(reserved);
    await new Promise(resolve => reserved.close(resolve));
    const child = spawn(process.execPath, ['.output/server/index.mjs'], {
        cwd: new URL('../../apps/editor/', import.meta.url),
        env: {
            ...process.env, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(proxyPort),
            NUXT_BACKEND_URL: `http://127.0.0.1:${port(backend)}`,
            NUXT_CODE_URL: `http://127.0.0.1:${port(code)}`,
            NUXT_PUBLIC_EDITOR_ORIGIN: 'https://office-code.apps.verentis.dev',
            NUXT_PUBLIC_WOPI_ORIGIN: 'https://office-wopi.apps.verentis.dev',
            NUXT_PUBLIC_WRAPPER_ORIGIN: 'https://office.apps.verentis.dev',
            NUXT_PUBLIC_SYNTHETIC_ONLY: 'false'
        },
        stdio: 'ignore'
    });
    try {
        let ready = false;
        for (let attempt = 0; attempt < 50; attempt++) {
            try {
                ready = (await fetch(`http://127.0.0.1:${proxyPort}/_ready`)).ok;
                if (ready) break;
            } catch { /* server not listening yet */ }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(ready, true, 'built editor starts');
        const source = 'https://office-wopi.apps.verentis.dev/wopi/00000000-0000-0000-0000-000000000001/6D61696E/files/00000000-0000-0000-0000-000000000002';
        const path = `/browser/dist/cool.html?WOPISrc=${encodeURIComponent(source)}`;
        const origin = `http://127.0.0.1:${proxyPort}`;
        const headers = { Host: 'office-code.apps.verentis.dev', 'Content-Type': 'application/x-www-form-urlencoded' };
        const response = await fetch(origin + path, {
            method: 'POST', headers, body: `access_token=${'a'.repeat(43)}&access_token_ttl=10000`
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-security-policy'),
            "default-src 'self';frame-ancestors https://office.apps.verentis.dev https://customer.example; connect-src 'self'");
        assert.equal(await response.text(), '<html>CODE</html>');
        assert.equal((await fetch(origin + path, { headers })).status, 403);
        assert.equal((await fetch(origin + '/', { headers: { Host: 'office.apps.verentis.dev' } })).status, 403);
        const wrapper = await fetch(origin + `/?embedTicket=${'a'.repeat(79)}`, {
            headers: { Host: 'office.apps.verentis.dev', 'X-Forwarded-Proto': 'https',
                'X-Forwarded-Host': 'office.apps.verentis.dev' }
        });
        assert.equal(wrapper.status, 200);
        assert.equal(wrapper.headers.get('content-security-policy'), 'frame-ancestors https://customer.example');
        assert.equal((await fetch(origin + '/_ready')).status, 200);
    } finally {
        child.kill('SIGTERM');
        await Promise.all([new Promise(resolve => backend.close(resolve)),
            new Promise(resolve => code.close(resolve))]);
    }
});
