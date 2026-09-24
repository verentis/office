import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const digest = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;
const name = /^[a-z][a-z0-9-]{1,30}$/;
export function render(config) {
    if (typeof config.region !== 'string' || !name.test(config.region) || config.region !== config.dataRegion) throw new Error('Explicit matching processing/data region required.');
    if (![config.editorImage, config.backendImage].every(value => typeof value === 'string' && digest.test(value))) throw new Error('Immutable tested editor/backend images required.');
    const lock = JSON.parse(readFileSync(new URL('./code.lock.json', import.meta.url)));
    return {
        name: `office-${config.region}`,
        services: {
            editor: {
                image: config.editorImage,
                read_only: true,
                environment: {
                    NUXT_BACKEND_URL: 'http://backend:8080',
                    NUXT_PUBLIC_SYNTHETIC_ONLY: 'false'
                },
                labels: { 'office.region': config.region, 'office.live-integration': 'disabled' },
                cap_drop: ['ALL'], security_opt: ['no-new-privileges:true']
            },
            backend: {
                image: config.backendImage,
                read_only: true,
                labels: { 'office.region': config.region, 'office.live-integration': 'disabled' },
                cap_drop: ['ALL'], security_opt: ['no-new-privileges:true']
            },
            code: {
                image: `${lock.repository}:${lock.tag}@${lock.digest}`,
                profiles: ['blocked-live-integration'],
                environment: { extra_params: '--o:ssl.enable=true --o:logging.level=warning --o:logging.anonymize.anonymize_user_data=true' },
                labels: { 'office.region': config.region, 'office.live-integration': 'disabled' }
            }
        },
        networks: { default: { internal: true } }
    };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    console.log(JSON.stringify(render(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2));
}
