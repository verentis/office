import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

test('built wrapper sends CODE-compatible save and waits for the durable receipt after acknowledgement',
    async ({ page }) => checkSaveBoundary(page, 'ordinary-save'));

test('built wrapper rebinds nonsecret Save As controls without reconstructing a token or reloading CODE',
    async ({ page }) => checkSaveBoundary(page, 'save-as'));

test('open Save As form cannot send a command after live authorization is revoked',
    async ({ page }) => checkSaveBoundary(page, 'save-as-revoked'));

test('failed CODE Save As preserves the source and requires a live status check before retry',
    async ({ page }) => checkSaveBoundary(page, 'save-as-denied'));

test('wrong-target continuation stays blocked without changing the CODE iframe or its launch',
    async ({ page }) => checkSaveBoundary(page, 'save-as-wrong-target'));

test('continued controls expire at the target deadline rather than the retained source launch deadline',
    async ({ page }) => checkSaveBoundary(page, 'save-as-expiry'));

async function checkSaveBoundary(page: Page, scenario: 'ordinary-save' | 'save-as' | 'save-as-revoked' | 'save-as-denied' | 'save-as-wrong-target' | 'save-as-expiry') {
    const parentOrigin = 'https://workspace.example.test';
    const wrapperOrigin = 'https://office.apps.verentis.dev';
    const codeOrigin = 'https://office-code.apps.verentis.dev';
    const wopiOrigin = 'https://api.verentis.dev';
    const server = createServer((request, response) => {
        if (request.url?.startsWith('/v1/collaboration/')) {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ parentOrigin }));
            return;
        }
        response.setHeader('Content-Type', 'text/html');
        response.setHeader('Content-Security-Policy', `frame-ancestors ${wrapperOrigin} ${parentOrigin}`);
        response.end(`<input id="retained" value="unsaved target text"><button id="save-as">Save As</button>
          <script>
          const send = data => parent.postMessage(JSON.stringify(data), ${JSON.stringify(wrapperOrigin)});
          let hostReady = false;
          document.body.dataset.saveAsCount = '0';
          document.querySelector('#retained').oninput = () =>
            send({MessageId:'Doc_ModifiedStatus',Values:{Modified:true}});
          document.querySelector('#save-as').onclick = () =>
            send({MessageId:'UI_SaveAs',Values:{format:'docx'}});
          window.addEventListener('message', event => {
            if(event.source !== parent || event.origin !== ${JSON.stringify(wrapperOrigin)}) return;
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if(data.MessageId === 'Host_PostmessageReady') hostReady = true;
            if(data.MessageId === 'Get_Views' && hostReady)
              send({MessageId:'Get_Views_Resp',Values:{Views:[]}});
            if(data.MessageId === 'Action_SaveAs' && hostReady) {
              document.body.dataset.saveAsCount = String(Number(document.body.dataset.saveAsCount) + 1);
              document.body.dataset.saveAsCommand = JSON.stringify(data.Values);
              if(data.Values.Filename !== 'copy.docx' || data.Values.Notify !== true) return;
              if(${JSON.stringify(scenario)} === 'save-as-denied') {
                send({MessageId:'Action_Save_Resp',Values:{success:false,result:'saveasfailed'}});
                return;
              }
              send({MessageId:'Action_Save_Resp',Values:{success:true,fileName:'copy.docx'}});
            }
            if(data.MessageId === 'Action_Save') {
              if(!hostReady || data.Values?.Notify !== true ||
                data.Values?.DontTerminateEdit !== true || data.Values?.DontSaveIfUnmodified !== false ||
                !['source-checkpoint','target-checkpoint'].includes(data.Values?.ExtendedData)) return;
              send({MessageId:'Doc_ModifiedStatus',Values:{Modified:false}});
              send({MessageId:'Action_Save_Resp',Values:{success:true}});
            }
          });
          send({MessageId:'App_LoadingStatus',Values:{Status:'Document_Loaded'}});
          send({MessageId:'Doc_ModifiedStatus',Values:{Modified:true}});
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
    const makeLaunch = (id: string, name: string) => {
        const source = `${wopiOrigin}/wopi/files/${id.repeat(32)}`;
        return { sessionId: id.repeat(32), nodeId: `node-${id}`, fileId: id.repeat(32), name,
            workspaceId: 'workspace', branch: 'main', format: 'docx', readOnly: false,
            accessToken: id.repeat(43), accessTokenTtl: Date.now() + 10 * 3600_000,
            editorOrigin: codeOrigin, wopiSource: source,
            action: `${codeOrigin}/browser/release/cool.html?WOPISrc=${encodeURIComponent(source)}` };
    };
    const launches = { source: makeLaunch('a', 'source.docx'), target: makeLaunch('b', 'copy.docx') };
    if (scenario === 'save-as-expiry') launches.target.accessTokenTtl = Date.now() + 3600_000;
    const { sessionId, nodeId, fileId, name, workspaceId, branch, format, readOnly, accessTokenTtl } = launches.target;
    const continuation = { sessionId, nodeId, fileId, name, workspaceId, branch, format, readOnly, accessTokenTtl };
    let documentPosts = 0;
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
                  const launches=${JSON.stringify(launches)};
                  const continuation=${JSON.stringify(continuation)};
                  window.active='source';window.derived=false;window.calls=[];window.checkpoint=null;
                  window.receiptVisible=false;window.revoked=false;
                  const office=document.querySelector('#office');
                  window.addEventListener('message',event=>{
                    if(event.source!==office.contentWindow||event.origin!==${JSON.stringify(wrapperOrigin)})return;
                    const d=event.data;
                    const reply=data=>office.contentWindow.postMessage(data,${JSON.stringify(wrapperOrigin)});
                    if(d.type==='verentis:ready') reply({type:'verentis:init',version:1,sessionId:'host',
                      context:{workspace:{id:'workspace'},file:{nodeId:'node-a',branch:'main'}},
                      token:{accessToken:'',expiresAt:new Date(Date.now()+3600000).toISOString(),scopes:[]}});
                    if(d.type==='verentis:wopi:request'){
                      window.calls.push({operation:d.operation,document:window.active});
                      let result;
                      if(d.operation==='launch')result=launches.source;
                      if(d.operation==='continue'){
                        window.releaseContinuation=()=>{
                          window.active='target';
                          reply({type:'verentis:wopi:response',version:1,sessionId:d.sessionId,
                            requestId:d.requestId,result:${scenario === 'save-as-wrong-target'
                                ? "{...continuation,workspaceId:'foreign'}" : 'continuation'}});
                        };
                        if(window.derived)window.releaseContinuation();
                        return;
                      }
                      if(d.operation==='save'){
                        window.checkpoint={generation:d.generation,
                          correlation:window.active+'-checkpoint',revision:window.active+'-commit'};
                        result={generation:d.generation,correlation:window.checkpoint.correlation,revision:null};
                      }
                      if(d.operation==='status')result={state:window.revoked?'revoked':'ready',revision:'target-commit',readOnly:false,
                        receipt:window.receiptVisible?window.checkpoint:null,
                        continuationAvailable:window.derived&&window.active==='source'};
                      reply({type:'verentis:wopi:response',version:1,sessionId:d.sessionId,requestId:d.requestId,result});
                    }
                  });
                  office.src=${JSON.stringify(`${wrapperOrigin}/?embedTicket=${'e'.repeat(43)}`)};
                  </script>` });
                return;
            }
            if (![wrapperOrigin, codeOrigin].includes(url.origin)) return route.abort();
            if (url.origin === codeOrigin && request.method() === 'POST') documentPosts++;
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
        if (scenario === 'save-as-expiry') await page.clock.install({ time: Date.now() });
        await page.goto(parentOrigin);
        const wrapper = page.frameLocator('#office');
        const code = wrapper.frameLocator('iframe[title="Verentis Collabora editor"]');
        await expect(code.locator('#retained')).toHaveValue('unsaved target text');
        if (scenario === 'ordinary-save') {
            await page.evaluate(origin => {
                document.querySelector('iframe')!.contentWindow!.postMessage({
                    type: 'verentis:action:invoke', version: 1, sessionId: 'host',
                    requestId: 'show-status', actionId: 'office.status',
                }, origin);
            }, wrapperOrigin);
            await expect(wrapper.getByRole('button', { name: 'Request save', exact: true })).toBeEnabled();
            await wrapper.getByRole('button', { name: 'Request save', exact: true }).click();
            await expect(wrapper.getByRole('status')).toContainText('CODE acknowledged save request');
            const polls = await page.evaluate(() => (window as any).calls
                .filter((call: { operation: string }) => call.operation === 'status').length);
            await expect.poll(() => page.evaluate(() => (window as any).calls
                .filter((call: { operation: string }) => call.operation === 'status').length))
                .toBeGreaterThan(polls);
            await expect(wrapper.getByTestId('dirty')).toBeAttached();
            await expect(wrapper.getByRole('status')).not.toContainText('Saved to Verentis.');
            await page.evaluate(() => { (window as any).receiptVisible = true; });
            await expect(wrapper.getByRole('status')).toHaveText('Saved to Verentis. Confirmed revision source-commit.');
            await expect(wrapper.getByTestId('dirty')).toHaveCount(0);
            expect(documentPosts).toBe(1);
            return;
        }
        await page.evaluate(origin => {
            document.querySelector('iframe')!.contentWindow!.postMessage({
                type: 'verentis:action:invoke', version: 1, sessionId: 'host',
                requestId: 'show-copy-status', actionId: 'office.status',
            }, origin);
        }, wrapperOrigin);
        await expect(wrapper.getByRole('button', { name: 'Request save', exact: true })).toBeEnabled();
        await page.evaluate(origin => {
            document.querySelector('iframe')!.contentWindow!.postMessage(
                JSON.stringify({ MessageId: 'UI_SaveAs', Values: { format: 'docx' } }), origin);
        }, wrapperOrigin);
        await expect(wrapper.getByRole('dialog', { name: 'Save As', exact: true })).toHaveCount(0);
        await code.getByRole('button', { name: 'Save As', exact: true }).click();
        const dialog = wrapper.getByRole('dialog', { name: 'Save As', exact: true });
        await expect(dialog.getByRole('textbox', { name: 'File name', exact: true })).toBeFocused();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(code.locator('body')).toHaveAttribute('data-save-as-count', '0');
        await expect(wrapper.getByTestId('dirty')).toBeAttached();
        await code.getByRole('button', { name: 'Save As', exact: true }).click();
        if (scenario === 'save-as-revoked') {
            await page.evaluate(() => { (window as any).revoked = true; });
            await expect(dialog.getByRole('button', { name: 'Confirm Save As', exact: true })).toBeDisabled();
            await expect(code.locator('body')).toHaveAttribute('data-save-as-count', '0');
            await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(wrapper.getByTestId('dirty')).toBeAttached();
            await expect(code.locator('#retained')).toHaveValue('unsaved target text');
            expect(documentPosts).toBe(1);
            return;
        }
        await dialog.getByRole('textbox', { name: 'File name', exact: true }).fill('../escape.docx');
        await dialog.getByRole('button', { name: 'Confirm Save As', exact: true }).click();
        await expect(dialog.getByRole('alert')).toContainText('without folders');
        await expect(code.locator('body')).toHaveAttribute('data-save-as-count', '0');
        await dialog.getByRole('textbox', { name: 'File name', exact: true }).fill('copy.docx');
        await dialog.getByRole('button', { name: 'Confirm Save As', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(code.locator('body')).toHaveAttribute('data-save-as-command',
            JSON.stringify({ Filename: 'copy.docx', Notify: true }));
        if (scenario === 'save-as-denied') {
            await expect(wrapper.getByRole('status')).toContainText('Save As was not acknowledged');
            await expect(wrapper.getByRole('button', { name: 'Request save', exact: true })).toBeEnabled();
            expect(await page.evaluate(() => (window as any).active)).toBe('source');
            await expect(wrapper.getByTestId('dirty')).toBeAttached();
            await expect(code.locator('#retained')).toHaveValue('unsaved target text');
            await code.getByRole('button', { name: 'Save As', exact: true }).click();
            await expect(dialog).toBeVisible();
            await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
            expect(documentPosts).toBe(1);
            return;
        }
        await expect.poll(() => page.evaluate(() => (window as any).calls
            .filter((call: { operation: string }) => call.operation === 'continue').length)).toBeGreaterThan(0);
        expect(await page.evaluate(() => (window as any).active)).toBe('source');
        await expect(wrapper.getByRole('button', { name: 'Request save', exact: true })).toBeDisabled();
        await code.locator('#retained').fill('later target edits retained across continuation');
        await page.evaluate(() => {
            (window as any).derived = true;
            (window as any).receiptVisible = true;
            (window as any).releaseContinuation();
        });
        await expect.poll(() => page.evaluate(() => (window as any).active)).toBe('target');
        await expect(wrapper.getByTestId('dirty')).toBeAttached();
        await expect(code.locator('#retained')).toHaveValue('later target edits retained across continuation');
        await expect(wrapper.locator('input[name="access_token"]')).toHaveValue(launches.source.accessToken);
        expect(documentPosts).toBe(1);
        if (scenario === 'save-as-wrong-target') {
            await expect(wrapper.getByRole('status')).toContainText('Save As continuation is unavailable');
            await expect(wrapper.getByRole('button', { name: 'Request save', exact: true })).toBeDisabled();
            expect(await page.evaluate(() => (window as any).calls
                .filter((call: { operation: string }) => call.operation === 'save').length)).toBe(0);
            return;
        }
        await expect.poll(() => page.evaluate(() => (window as any).calls
            .filter((call: { operation: string; document: string }) => call.operation === 'status' && call.document === 'target').length))
            .toBeGreaterThan(0);
        await expect(wrapper.getByRole('button', { name: 'Request save', exact: true })).toBeEnabled();
        await wrapper.getByRole('button', { name: 'Request save', exact: true }).click();
        await expect(wrapper.getByRole('status')).toHaveText('Saved to Verentis. Confirmed revision target-commit.');
        expect(await page.evaluate(() => (window as any).calls
            .filter((call: { operation: string }) => call.operation === 'save')))
            .toEqual([{ operation: 'save', document: 'target' }]);
        await expect(wrapper.getByTestId('dirty')).toHaveCount(0);
        expect(await page.evaluate(() => (window as any).calls
            .filter((call: { operation: string }) => call.operation === 'launch').length)).toBe(1);
        expect(documentPosts).toBe(1);
        if (scenario === 'save-as-expiry') {
            await page.clock.fastForward(3600_001);
            await expect(wrapper.getByRole('status')).toContainText('absolute expiry');
            await expect(wrapper.getByRole('button', { name: 'Request save', exact: true })).toBeDisabled();
            expect(launches.source.accessTokenTtl).toBeGreaterThan(await page.evaluate(() => Date.now()));
            await expect(code.locator('#retained')).toHaveValue('later target edits retained across continuation');
            expect(documentPosts).toBe(1);
        }
    } finally {
        await page.unrouteAll({ behavior: 'wait' });
        child.kill('SIGTERM');
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}
