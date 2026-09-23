import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('artifacts/browsers');
process.env.TMPDIR = resolve('artifacts');

export default defineConfig({
    testDir: './tests/browser',
    timeout: 120000,
    expect: { timeout: 60000 },
    workers: 1,
    retries: 0,
    reporter: [['list'], ['json', { outputFile: 'artifacts/browser-results.json' }]],
    use: {
        baseURL: 'https://office.localhost:8443',
        ignoreHTTPSErrors: true,
        viewport: { width: 1440, height: 1080 },
        trace: 'off',
        screenshot: 'only-on-failure',
        launchOptions: { args: ['--ignore-certificate-errors'] }
    }
});
