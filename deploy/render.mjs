import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const digest = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;
const name = /^[a-z][a-z0-9-]{1,30}$/;
export function render(config) {
    if (typeof config.region !== 'string' || !name.test(config.region) || config.region !== config.dataRegion) throw new Error('Explicit matching processing/data region required.');
    if (typeof config.editorImage !== 'string' || !digest.test(config.editorImage)) throw new Error('Immutable tested editor image required.');
    for (const field of ['platformOrigin', 'editorOrigin', 'codeOrigin']) {
        const value = new URL(config[field]);
        if (value.protocol !== 'https:' || value.origin !== config[field] || value.username || value.password)
            throw new Error(`Exact HTTPS ${field} required.`);
    }
    if (typeof config.proofKeyFile !== 'string' || !config.proofKeyFile.startsWith('/'))
        throw new Error('An absolute operator-managed CODE proof key path is required.');
    const lock = JSON.parse(readFileSync(new URL('./code.lock.json', import.meta.url)));
    return {
        name: `office-${config.region}`,
        services: {
            editor: {
                image: config.editorImage,
                read_only: true,
                environment: {
                    NUXT_COLLABORATION_URL: config.platformOrigin,
                    NUXT_CODE_URL: 'http://code:9980',
                    NUXT_PUBLIC_WOPI_ORIGIN: config.platformOrigin,
                    NUXT_PUBLIC_WRAPPER_ORIGIN: config.editorOrigin,
                    NUXT_PUBLIC_EDITOR_ORIGIN: config.codeOrigin
                },
                labels: { 'office.region': config.region, 'office.authority': 'platform' },
                cap_drop: ['ALL'], security_opt: ['no-new-privileges:true']
            },
            code: {
                image: `${lock.repository}:${lock.tag}@${lock.digest}`,
                user: '1001:1001',
                cap_add: ['MKNOD'],
                shm_size: '256m',
                command: [`--o:net.content_security_policy=frame-ancestors ${config.editorOrigin};`],
                volumes: [{ type: 'bind', source: config.proofKeyFile, target: '/etc/coolwsd/proof_key', read_only: true }],
                environment: {
                    SAL_LOG: '-INFO-WARN',
                    aliasgroup1: `https://${new URL(config.platformOrigin).hostname}:${new URL(config.platformOrigin).port || '443'}`,
                    extra_params: '--o:ssl.enable=false --o:ssl.termination=true --o:ssl.ssl_verification=true ' +
                        `--o:server_name=${new URL(config.codeOrigin).host} ` +
                        '--o:net.connection_timeout_secs=120 ' +
                        '--o:logging.level=none --o:logging.level_startup=none ' +
                        '--o:logging.most_verbose_level_settable_from_client=none ' +
                        '--o:logging.least_verbose_level_settable_from_client=none ' +
                        '--o:browser_logging=false --o:logging.protocol=false ' +
                        '--o:logging.file[@enable]=false --o:logging_ui_cmd.file[@enable]=false ' +
                        '--o:trace[@enable]=false --o:admin_console.enable=false ' +
                        '--o:logging.lokit_sal_log=-INFO-WARN --o:logging.anonymize.anonymize_user_data=true'
                },
                labels: { 'office.region': config.region, 'office.authority': 'platform' }
            }
        },
        networks: { default: {} }
    };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    console.log(JSON.stringify(render(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2));
}
