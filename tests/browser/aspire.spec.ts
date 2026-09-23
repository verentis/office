import { test, expect, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';

const logStart = new Date().toISOString();
test.afterAll(() => {
    const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' }).trim().split('\n');
    for (const resource of ['office-code', 'office-wopi', 'frontend-gateway']) {
        const matches = names.filter(name => new RegExp(`^${resource}-[a-z0-9]+$`).test(name));
        expect(matches, `Expected one running ${resource} from the local Aspire host`).toHaveLength(1);
        const output = spawnSync('docker', ['logs', '--since', logStart, matches[0]!], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024
        });
        expect(output.status, `${resource} log read must succeed`).toBe(0);
        const logs = output.stdout + output.stderr;
        // Report only the boolean result: failed assertions must never print credential-bearing logs.
        expect(/access_token(?:=|%3D)[A-Za-z0-9_-]{43}/.test(logs), `${resource} must not log WOPI credential URLs`).toBe(false);
    }
});

async function open(page: Page, fileId?: string) {
    await page.goto('/');
    if (fileId) await page.getByLabel('Existing synthetic file ID (optional)').fill(fileId);
    await page.getByRole('button', { name: 'Open synthetic file' }).click();
    await expect(page.getByRole('status')).toContainText('Synthetic editor loaded', { timeout: 90000 });
    return (await page.getByTestId('file-id').textContent())!;
}

async function editAndSave(page: Page, marker: string) {
    const child = page.frames().find(frame => frame.url().startsWith('https://office-code.localtest.me/browser/'))!;
    expect(child).toBeTruthy();
    const canvas = child.locator('#document-container');
    await expect(canvas).toBeVisible();
    await canvas.click({ position: { x: 450, y: 220 } });
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type(marker);
    await expect(page.getByTestId('dirty')).toBeVisible();
    await page.getByRole('button', { name: 'Request save' }).click();
}

async function containsMarkers(page: Page, file: string, markers: string[]) {
    const response = await page.request.get(`/api/test/files/${file}`);
    expect(response.status()).toBe(200);
    const saved = await response.json();
    return saved.version > 1 && execFileSync('python3', ['-c',
        'import sys,base64,io,zipfile; z=zipfile.ZipFile(io.BytesIO(base64.b64decode(sys.stdin.read()))); text="".join(z.read(n).decode("utf-8","ignore") for n in z.namelist() if n.endswith(".xml")); print(all(m in text for m in sys.argv[1:]))',
        ...markers], { input: saved.content, encoding: 'utf8' }).trim() === 'True';
}

test('trusted Aspire HTTPS/WSS and CODE callback save survive fresh reopen', async ({ page, browser, request }) => {
    expect((await request.get('/_ready')).status()).toBe(200);
    const health = await request.get('https://office-wopi.localtest.me/health');
    expect(await health.json()).toEqual({ status: 'synthetic-only', liveIntegration: 'disabled' });
    const discovery = await request.get('https://office-code.localtest.me/hosting/discovery');
    expect(discovery.status()).toBe(200);
    expect(await discovery.text()).toContain('https://office-code.localtest.me/browser/');
    const sockets: string[] = [];
    page.on('websocket', socket => sockets.push(socket.url().split('?')[0]));
    const file = await open(page);
    const marker = `AspireSaved${Date.now()}`;
    await editAndSave(page, marker);
    await expect.poll(() => containsMarkers(page, file, [marker])).toBe(true);
    expect(sockets.some(url => url.startsWith('wss://office-code.localtest.me/'))).toBe(true);
    await page.close();

    const context = await browser.newContext({
        baseURL: 'https://office.localtest.me', ignoreHTTPSErrors: false,
        viewport: { width: 1440, height: 1080 }
    });
    const reopened = await context.newPage();
    expect(await open(reopened, file)).toBe(file);
    const second = `AspireReopened${Date.now()}`;
    await editAndSave(reopened, second);
    await expect.poll(() => containsMarkers(reopened, file, [marker, second])).toBe(true);
    await context.close();
});

test('Aspire synthetic routes do not admit live sessions or foreign origins', async ({ request }) => {
    const live = await request.post('/api/sessions', { headers: { Origin: 'https://office.localtest.me' }, data: {} });
    expect(live.status()).toBe(503);
    expect(await live.text()).not.toContain('accessToken');
    for (const origin of ['https://evil.invalid', 'https://office.localhost:8443']) {
        expect((await request.post('/api/test/sessions', { headers: { Origin: origin }, data: { format: 'docx' } })).status()).toBe(403);
    }
    expect((await request.post('https://office-wopi.localtest.me/test/sessions', { data: { format: 'docx' } })).status()).toBe(403);
});
