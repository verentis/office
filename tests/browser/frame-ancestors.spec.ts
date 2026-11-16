import { expect, test } from '@playwright/test';

test('the browser checks both ancestors of the nested CODE frame', async ({ page }) => {
    await page.route('**/*', async route => {
        const host = new URL(route.request().url()).hostname;
        if (host === 'workspace.example.test' || host === 'unregistered.example.test') {
            await route.fulfill({
                contentType: 'text/html',
                body: '<iframe id="office" src="https://office.apps.verentis.dev/"></iframe>'
            });
        } else if (host === 'office.apps.verentis.dev') {
            await route.fulfill({
                contentType: 'text/html',
                headers: { 'Content-Security-Policy': 'frame-ancestors https://workspace.example.test https://unregistered.example.test' },
                body: '<iframe id="code" src="https://office-code.apps.verentis.dev/browser/dist/cool.html"></iframe>'
            });
        } else if (host === 'office-code.apps.verentis.dev') {
            await route.fulfill({
                contentType: 'text/html',
                headers: { 'Content-Security-Policy':
                    'frame-ancestors https://office.apps.verentis.dev https://workspace.example.test' },
                body: '<h1 id="loaded">CODE document</h1>'
            });
        } else {
            await route.abort();
        }
    });

    await page.goto('https://workspace.example.test/');
    await expect(page.frameLocator('#office').frameLocator('#code').getByText('CODE document')).toBeVisible();

    await page.goto('https://unregistered.example.test/');
    await expect(page.frameLocator('#office').frameLocator('#code').getByText('CODE document')).not.toBeVisible();
});
