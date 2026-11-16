import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

test('the live agent channel reads the selection and pastes text into the open document only', async ({ page }) => {
    await withWrapper(page, async (send, code) => {
        expect(await send({ action: 'read', path: '/docs/other.docx' })).toMatchObject({ ok: false, code: 'not_open' });

        expect(await send({ action: 'read', path: '/docs/source.docx' })).toMatchObject({ ok: false, code: 'use_headless' });

        await code.locator('#selection').fill('Quarterly summary');
        const read = await send({ action: 'read', path: '/docs/source.docx' });
        expect(read).toMatchObject({ ok: true, scope: 'selection', content: 'Quarterly summary', path: '/docs/source.docx' });

        expect(await send({ action: 'apply', path: '/docs/source.docx', operations: [{ op: 'delete_range' }] }))
            .toMatchObject({ ok: false, code: 'unsupported_operation' });
        await expect(code.locator('body')).toHaveAttribute('data-pastes', '[]');

        const applied = await send({ action: 'apply', path: '/docs/source.docx',
            operations: [{ op: 'insert_text', text: 'Hello' }, { op: 'insert_text', text: ' world' }] });
        expect(applied).toMatchObject({ ok: true, applied: 2, saved: false });
        await expect(code.locator('body')).toHaveAttribute('data-pastes', JSON.stringify([
            { Mimetype: 'text/plain;charset=utf-8', Data: 'Hello' },
            { Mimetype: 'text/plain;charset=utf-8', Data: ' world' },
        ]));
        await expect(code.locator('body')).toHaveAttribute('data-saves', '0');
    });
});

test('a read-only document refuses live edits but still reads the selection', async ({ page }) => {
    await withWrapper(page, async (send, code) => {
        expect(await send({ action: 'apply', path: '/docs/source.docx', operations: [{ op: 'insert_text', text: 'x' }] }))
            .toMatchObject({ ok: false, code: 'read_only' });
        await code.locator('#selection').fill('Read me');
        expect(await send({ action: 'read', path: '/docs/source.docx' })).toMatchObject({ ok: true, content: 'Read me' });
        await expect(code.locator('body')).toHaveAttribute('data-pastes', '[]');
    }, { readOnly: true });
});

type Send = (payload: unknown) => Promise<unknown>;

async function withWrapper(page: Page, body: (send: Send, code: ReturnType<ReturnType<Page['frameLocator']>['frameLocator']>) => Promise<void>,
    options: { readOnly?: boolean } = {}) {
    const parentOrigin = 'https://workspace.example.test';
    const wrapperOrigin = 'https://office.apps.verentis.dev';
    const codeOrigin = 'https://office-code.apps.verentis.dev';
    const wopiOrigin = 'https://api.verentis.dev';
    // A stand-in for CODE: Action_Copy answers with the text in #selection, or not at all when it is empty (real
    // CODE answers with empty content; both mean no selection). Action_Paste and Action_Save are recorded.
    const server = createServer((request, response) => {
        if (request.url?.startsWith('/v1/collaboration/')) {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ parentOrigin }));
            return;
        }
        response.setHeader('Content-Type', 'text/html');
        response.setHeader('Content-Security-Policy', `frame-ancestors ${wrapperOrigin} ${parentOrigin}`);
        response.end(`<input id="selection" value="">
          <script>
          const send = data => parent.postMessage(JSON.stringify(data), ${JSON.stringify(wrapperOrigin)});
          const pastes = [];
          document.body.dataset.pastes = '[]';
          document.body.dataset.saves = '0';
          window.addEventListener('message', event => {
            if(event.source !== parent || event.origin !== ${JSON.stringify(wrapperOrigin)}) return;
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if(data.MessageId === 'Action_Copy' && data.Values?.Mimetype === 'text/plain;charset=utf-8') {
              const text = document.querySelector('#selection').value;
              if(text) send({MessageId:'Action_Copy_Resp',Values:{content:text}});
            }
            if(data.MessageId === 'Action_Paste') {
              pastes.push(data.Values);
              document.body.dataset.pastes = JSON.stringify(pastes);
            }
            if(data.MessageId === 'Action_Save')
              document.body.dataset.saves = String(Number(document.body.dataset.saves) + 1);
          });
          send({MessageId:'App_LoadingStatus',Values:{Status:'Document_Loaded'}});
          </script>`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const backendPort = (server.address() as { port: number }).port;
    const reservation = createServer();
    await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const wrapperPort = (reservation.address() as { port: number }).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    const child = spawn(process.execPath, ['.output/server/index.mjs'], {
        cwd: new URL('../../apps/editor/', import.meta.url),
        env: { ...process.env, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(wrapperPort),
            NUXT_COLLABORATION_URL: `http://127.0.0.1:${backendPort}`,
            NUXT_CODE_URL: `http://127.0.0.1:${backendPort}`,
            NUXT_PUBLIC_EDITOR_ORIGIN: codeOrigin, NUXT_PUBLIC_WOPI_ORIGIN: wopiOrigin,
            NUXT_PUBLIC_WRAPPER_ORIGIN: wrapperOrigin },
        stdio: 'ignore',
    });
    const source = `${wopiOrigin}/wopi/files/${'a'.repeat(32)}`;
    const launch = { sessionId: 'a'.repeat(32), nodeId: 'node-a', fileId: 'a'.repeat(32), name: 'source.docx',
        workspaceId: 'workspace', branch: 'main', format: 'docx', readOnly: options.readOnly === true,
        accessToken: 'a'.repeat(43), accessTokenTtl: Date.now() + 10 * 3600_000,
        editorOrigin: codeOrigin, wopiSource: source,
        action: `${codeOrigin}/browser/release/cool.html?WOPISrc=${encodeURIComponent(source)}` };
    try {
        await expect.poll(async () => {
            try { return (await fetch(`http://127.0.0.1:${wrapperPort}/_ready`)).status; }
            catch { return 0; }
        }).toBe(200);
        await page.route('**/*', async route => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin === parentOrigin) {
                await route.fulfill({ contentType: 'text/html', body: `
                  <iframe id="office" style="width:100%;height:90vh;border:0"></iframe><script>
                  const office=document.querySelector('#office');
                  const wrapper=${JSON.stringify(wrapperOrigin)};
                  const pending=new Map();
                  window.sendAgent=payload=>new Promise(resolve=>{
                    const requestId='r'+Math.random().toString(36).slice(2);
                    pending.set(requestId,resolve);
                    office.contentWindow.postMessage({type:'verentis:host:message',version:1,sessionId:'host',
                      requestId,channel:'agent',payload},wrapper);
                  });
                  window.addEventListener('message',event=>{
                    if(event.source!==office.contentWindow||event.origin!==wrapper)return;
                    const d=event.data;
                    const reply=data=>office.contentWindow.postMessage(data,wrapper);
                    if(d.type==='verentis:ready') reply({type:'verentis:init',version:1,sessionId:'host',
                      context:{workspace:{id:'workspace'},surface:'file',
                        file:{nodeId:'node-a',branch:'main',path:'/docs/source.docx',name:'source.docx',mimeType:'application/octet-stream',size:1}},
                      token:{accessToken:'',expiresAt:new Date(Date.now()+3600000).toISOString(),scopes:[]}});
                    if(d.type==='verentis:host:reply'&&pending.has(d.requestId)){
                      pending.get(d.requestId)(d.error?{error:d.error}:d.result);pending.delete(d.requestId);
                    }
                    if(d.type==='verentis:wopi:request'){
                      let result;
                      if(d.operation==='launch')result=${JSON.stringify(launch)};
                      if(d.operation==='status')result={state:'ready',revision:'r1',readOnly:${options.readOnly === true},receipt:null};
                      reply({type:'verentis:wopi:response',version:1,sessionId:d.sessionId,requestId:d.requestId,result});
                    }
                  });
                  office.src=${JSON.stringify(`${wrapperOrigin}/?embedTicket=${'e'.repeat(43)}`)};
                  </script>` });
                return;
            }
            if (![wrapperOrigin, codeOrigin].includes(url.origin)) return route.abort();
            const headers = { ...await request.allHeaders(), Host: url.host,
                'X-Forwarded-Host': url.host, 'X-Forwarded-Proto': 'https' };
            const response = await fetch(`http://127.0.0.1:${wrapperPort}${url.pathname}${url.search}`, {
                method: request.method(), headers, body: request.postDataBuffer() ?? undefined, redirect: 'manual',
            });
            const responseHeaders = Object.fromEntries(response.headers);
            for (const name of ['content-encoding', 'content-length', 'transfer-encoding']) delete responseHeaders[name];
            await route.fulfill({ status: response.status, headers: responseHeaders,
                body: Buffer.from(await response.arrayBuffer()) });
        });
        await page.goto(parentOrigin);
        const code = page.frameLocator('#office').frameLocator('iframe[title="Verentis Collabora editor"]');
        await expect(code.locator('#selection')).toBeAttached();
        const send: Send = payload => page.evaluate(p => (window as any).sendAgent(p), payload);
        await expect.poll(() => send({ action: 'apply', path: '/docs/source.docx', operations: [] }))
            .not.toMatchObject({ code: 'not_ready' });
        await body(send, code);
    } finally {
        await page.unrouteAll({ behavior: 'wait' });
        child.kill('SIGTERM');
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}
