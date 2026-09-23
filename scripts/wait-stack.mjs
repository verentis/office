import https from 'node:https';
import { setTimeout } from 'node:timers/promises';

for (const hostname of ['office.localhost', 'code.localhost', 'wopi.localhost']) {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
        ready = await new Promise(resolve => {
            const request = https.get({
                hostname, port: 8443, path: hostname.startsWith('code') ? '/hosting/discovery' : hostname.startsWith('wopi') ? '/health' : '/',
                rejectUnauthorized: false,
                lookup: (_host, options, callback) => options.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4),
                timeout: 3000
            }, response => { response.resume(); resolve(response.statusCode === 200); });
            request.on('error', () => resolve(false));
            request.on('timeout', () => request.destroy());
        });
        if (ready) break;
        await setTimeout(2000);
    }
    if (!ready) throw new Error(`${hostname} did not become healthy.`);
}
console.log('Synthetic wrapper, CODE discovery and harness are responsive.');
