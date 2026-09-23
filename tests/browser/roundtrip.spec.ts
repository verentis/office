import { test, expect, type Page } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const logStart = new Date().toISOString();
test.afterAll(async () => {
    const process = spawn('docker', ['compose', '-f', 'dev/compose.yaml', 'logs', '--no-color', '--since', logStart], { stdio: ['ignore', 'pipe', 'ignore'] });
    const finished = new Promise<number | null>((resolve, reject) => { process.on('close', resolve); process.on('error', reject); });
    let credentialFound = false;
    for await (const line of createInterface({ input: process.stdout! })) {
        credentialFound ||= /access_token=[A-Za-z0-9_-]{43}|MUST_NOT_LEAVE_HOST/.test(line);
    }
    expect(await finished).toBe(0);
    expect(credentialFound, 'Compose logs must not contain plaintext credentials').toBe(false);
});

async function open(page: Page, format: string, fileId?: string) {
    await page.goto('https://office.localhost:8443');
    await page.getByRole('combobox').selectOption(format);
    if (fileId) await page.getByLabel('Existing synthetic file ID (optional)').fill(fileId);
    await page.getByRole('button', { name: 'Open synthetic file' }).click();
    await expect(page.getByRole('status')).toContainText('Synthetic editor loaded', { timeout: 90000 });
    return (await page.getByTestId('file-id').textContent())!;
}
async function persisted(page: Page, file: string) {
    const response = await page.request.get(`https://office.localhost:8443/api/test/files/${file}`);
    expect(response.status()).toBe(200);
    return await response.json();
}
function xmlContains(content: string, marker: string) {
    return execFileSync('python3', ['-c', 'import sys,base64,io,zipfile; z=zipfile.ZipFile(io.BytesIO(base64.b64decode(sys.stdin.read()))); print(any(sys.argv[1] in z.read(n).decode("utf-8","ignore") for n in z.namelist() if n.endswith(".xml")))', marker], { input: content, encoding: 'utf8' }).trim() === 'True';
}
async function edit(page: Page, format: string, marker: string) {
    const child = page.frames().find(frame => frame.url().startsWith('https://code.localhost:8443/browser/'))!;
    expect(child).toBeTruthy();
    const canvas = child.locator('#document-container');
    await expect(canvas).toBeVisible();
    if (['docx', 'odt'].includes(format)) {
        await canvas.click({ position: { x: 450, y: 220 } });
        await page.keyboard.press('Control+End');
        await page.keyboard.press('Enter');
        await page.keyboard.type(marker);
    } else if (['xlsx', 'ods'].includes(format)) {
        const address = child.getByRole('combobox', { name: 'Name Box', exact: true });
        await address.fill(marker.startsWith('Reopened') ? 'A3' : 'A2');
        await address.press('Enter');
        await page.keyboard.type(marker);
        await page.keyboard.press('Enter');
    } else {
        await child.getByRole('tab', { name: 'Insert', exact: true }).click();
        await child.getByRole('button', { name: 'Text', exact: true }).click();
        await child.getByRole('button', { name: 'Text Box', exact: true }).click();
        const box = (await canvas.boundingBox())!;
        await page.mouse.move(box.x + 150, box.y + 200);
        await page.mouse.down();
        await page.mouse.move(box.x + 550, box.y + 300, { steps: 10 });
        await page.mouse.up();
        // Impress creates a shape first; F2 enters its text-edit mode after the server round trip.
        await page.waitForTimeout(500);
        await page.keyboard.press('F2');
        await page.waitForTimeout(500);
        await page.keyboard.type(marker, { delay: 40 });
        await page.keyboard.press('Escape');
    }
}
for (const format of ['docx', 'odt', 'xlsx', 'ods', 'pptx', 'odp']) {
    test(`${format}: real CODE edit, durable save and fresh reopen`, async ({ page, browser }) => {
        const file = await open(page, format);
        const marker = `Verified${format}${Date.now()}`;
        await edit(page, format, marker);
        await expect(page.getByTestId('dirty')).toBeVisible();
        expect(await page.evaluate(() => {
            const event = new Event('beforeunload', { cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
        })).toBe(true);
        await page.getByRole('button', { name: 'Request save' }).click();
        await expect.poll(async () => {
            const result = await persisted(page, file);
            return result.version > 1 && xmlContains(result.content, marker);
        }, { timeout: 60000, message: `${format}: saved synthetic XML must contain typed marker` }).toBe(true);
        await expect(page.getByTestId('dirty')).toBeVisible();
        await page.close();
        if (format === 'docx') {
            execFileSync('docker', ['compose', '-f', 'dev/compose.yaml', 'restart', 'harness', 'code'], { stdio: 'pipe' });
            execFileSync('node', ['scripts/wait-stack.mjs'], { stdio: 'pipe' });
        }
        // A new browser context prevents browser state from masquerading as persistence.
        const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1080 } });
        const reopened = await context.newPage();
        await reopened.goto('https://office.localhost:8443');
        expect(await open(reopened, format, file)).toBe(file);
        const reopenedMarker = `Reopened${format}${Date.now()}`;
        await edit(reopened, format, reopenedMarker);
        await reopened.getByRole('button', { name: 'Request save' }).click();
        await expect.poll(async () => {
            const result = await persisted(reopened, file);
            return xmlContains(result.content, marker) && xmlContains(result.content, reopenedMarker);
        }, { timeout: 60000, message: 'A save from the reopened editor must preserve prior content and include the new edit' }).toBe(true);
        await context.close();
    });
}
test('harness rejects missing identity and live admission stays disabled', async ({ request }) => {
    const denied = await request.post('https://wopi.localhost:8443/test/sessions', { data: { format: 'docx' } });
    expect(denied.status()).toBe(403);
    const live = await request.post('/api/sessions', { headers: { Origin: 'https://office.localhost:8443' }, data: {} });
    expect(live.status()).toBe(503);
    expect(await live.text()).not.toContain('accessToken');
    for (const headers of [
        { Origin: 'https://evil.invalid', 'X-Test-Identity': 'synthetic-user' },
        { Origin: 'https://office.localhost:8443', 'X-Test-Identity': 'other-user' }
    ]) expect((await request.post('https://wopi.localhost:8443/test/sessions', { headers, data: { format: 'docx' } })).status()).toBe(403);
    expect((await request.post('/api/test/sessions', {
        headers: { Origin: 'https://office.localhost:8443' }, data: { format: 'exe' }
    })).status()).toBe(400);
    for (const headers of [{}, { Origin: 'https://evil.invalid' }]) {
        expect((await request.post('/api/test/sessions', { headers, data: { format: 'docx' } })).status()).toBe(403);
    }
    const missing = await request.post('/api/test/sessions', {
        headers: { Origin: 'https://office.localhost:8443' }, data: { format: 'docx', fileId: '0'.repeat(32) }
    });
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toBe('');
});

test('synthetic parent SDK handshake is prompt without live content or token transfer', async ({ page }) => {
    const leaked: string[] = [];
    page.on('request', request => {
        if ((request.postData() ?? '').includes('MUST_NOT_LEAVE_HOST') || request.url().includes('MUST_NOT_LEAVE_HOST')) leaked.push(request.url().split('?')[0]);
    });
    await page.goto('https://host.localhost:8443/');
    const wrapper = page.frameLocator('iframe');
    await expect(wrapper.getByRole('status')).toContainText('Host connected. Live integration unavailable', { timeout: 10000 });
    expect(await page.evaluate(() => (window as unknown as { readyReceived: boolean }).readyReceived)).toBe(true);
    await expect(wrapper.locator('iframe')).toHaveCount(0);
    await wrapper.getByRole('button', { name: 'Open synthetic file' }).click();
    await expect(wrapper.getByRole('status')).toContainText('Synthetic editor loaded');
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage(
        { MessageId: 'Doc_ModifiedStatus', Values: { Modified: true } }, 'https://office.localhost:8443'));
    await expect(wrapper.getByTestId('dirty')).toHaveCount(0);
    expect(leaked).toEqual([]);
});

test('expired authorization disables saves and reset requires explicit discard', async ({ page }) => {
    await page.route('**/api/test/sessions', async route => {
        const response = await route.fetch();
        const payload = await response.json();
        await route.fulfill({ response, json: { ...payload, accessTokenTtl: Date.now() + 8000 } });
    });
    const file = await open(page, 'docx');
    await expect(page.getByRole('alert')).toContainText('Session expired', { timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Request save' })).toBeDisabled();
    const child = page.frames().find(frame => frame.url().startsWith('https://code.localhost:8443/browser/'))!;
    await child.evaluate(() => window.parent.postMessage(JSON.stringify({
        MessageId: 'Action_Save_Resp', Values: { success: true }
    }), 'https://office.localhost:8443'));
    await expect(page.getByRole('status')).toContainText('session expired');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Discard editor and reset launch' }).click();
    await expect(page.getByTestId('file-id')).toHaveText(file);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Discard editor and reset launch' }).click();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open synthetic file' })).toBeEnabled();
});

test('unacknowledged save times out without losing dirty protection', async ({ page }) => {
    await page.addInitScript(() => window.addEventListener('message', event => {
        const data = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
        if (data?.includes('"Action_Save_Resp"')) event.stopImmediatePropagation();
    }, true));
    await open(page, 'docx');
    await edit(page, 'docx', `Timeout${Date.now()}`);
    await page.getByRole('button', { name: 'Request save' }).click();
    await expect(page.getByRole('status')).toContainText('Save acknowledgement timed out', { timeout: 35000 });
    await expect(page.getByTestId('dirty')).toBeVisible();
});

test('delayed SDK initialization does not interrupt child readiness or dirty events', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://host.localhost:8443/?handshake=delayed');
    const wrapper = page.frameLocator('iframe');
    await wrapper.getByRole('button', { name: 'Open synthetic file' }).click();
    await expect(wrapper.getByRole('status')).toContainText('Synthetic editor loaded', { timeout: 10000 });
    await edit(page, 'docx', `Delayed${Date.now()}`);
    await expect(wrapper.getByTestId('dirty')).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { dirtyReceived?: boolean }).dirtyReceived),
        { timeout: 20000 }).toBe(true);
    expect(errors).toEqual([]);
});
