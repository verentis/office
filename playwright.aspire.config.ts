import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('artifacts/browsers');
process.env.TMPDIR = resolve('artifacts');

export default defineConfig({
    testDir: './tests/browser',
    testMatch: 'aspire.spec.ts',
    timeout: 120000,
    expect: { timeout: 60000 },
    workers: 1,
    retries: 0,
    reporter: [['list'], ['json', { outputFile: 'artifacts/aspire/browser-results.json' }]],
    use: {
        baseURL: 'https://office.localtest.me',
        ignoreHTTPSErrors: false,
        viewport: { width: 1440, height: 1080 },
        trace: 'off',
        screenshot: 'only-on-failure'
    }
});
