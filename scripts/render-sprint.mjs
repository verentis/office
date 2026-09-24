import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseAllDocuments, stringify } from 'yaml';

const root = new URL('../', import.meta.url);
const required = [
    'AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID',
    'ACR_NAME', 'ACR_LOGIN_SERVER', 'AKS_CLUSTER_NAME', 'AKS_RESOURCE_GROUP',
    'OFFICE_PLATFORM_ORIGIN', 'OFFICE_CLIENT_ID',
    'OFFICE_BACKEND_SECRET', 'OFFICE_STATE_PVC'
];
const dnsName = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const digest = /^sha256:[a-f0-9]{64}$/;

function requireInput(env, name) {
    const value = env[name];
    if (!value || !value.trim() || value !== value.trim()) throw new Error(`Missing or invalid ${name}`);
    return value;
}

export function validate(env, lock = JSON.parse(readFileSync(new URL('deploy/code.lock.json', root)))) {
    for (const name of required) requireInput(env, name);
    for (const name of ['AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID', 'OFFICE_CLIENT_ID']) {
        if (!/^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(env[name]) ||
            /^0{8}(-0{4}){3}-0{12}$/.test(env[name]))
            throw new Error(`Invalid ${name}: expected nonzero GUID`);
    }
    for (const name of ['ACR_NAME', 'AKS_CLUSTER_NAME', 'AKS_RESOURCE_GROUP', 'OFFICE_BACKEND_SECRET', 'OFFICE_STATE_PVC']) {
        if (!dnsName.test(env[name])) throw new Error(`Invalid ${name}`);
    }
    const clusterLocation = /^aks-verentis-dev-([a-z0-9]+)$/.exec(env.AKS_CLUSTER_NAME);
    if (!clusterLocation ||
        env.AKS_RESOURCE_GROUP !== `rg-verentis-platform-dev-${clusterLocation[1]}`)
        throw new Error('AKS_CLUSTER_NAME and AKS_RESOURCE_GROUP must identify the same dev cluster location');
    if (!/^[a-z0-9-]+\.azurecr\.io$/.test(env.ACR_LOGIN_SERVER) ||
        env.ACR_LOGIN_SERVER !== `${env.ACR_NAME}.azurecr.io`)
        throw new Error('ACR_LOGIN_SERVER must match ACR_NAME');
    const sprint = /^https:\/\/api\.(sprint-[a-z0-9]+(?:-[a-z0-9]+)*)\.verentis\.dev$/.exec(env.OFFICE_PLATFORM_ORIGIN);
    if (!sprint)
        throw new Error('OFFICE_PLATFORM_ORIGIN must be the sprint platform API origin');
    if (lock.repository !== 'docker.io/collabora/code' ||
        !/^\d+(?:\.\d+)+$/.test(lock.tag) || !digest.test(lock.digest))
        throw new Error('Invalid pinned CODE image in deploy/code.lock.json');
    return sprint[1];
}

export function renderSprint(env, lock = JSON.parse(readFileSync(new URL('deploy/code.lock.json', root)))) {
    validate(env, lock);
    for (const name of ['EDITOR_IMAGE', 'BACKEND_IMAGE']) {
        if (!new RegExp(`^${env.ACR_LOGIN_SERVER.replaceAll('.', '\\.')}/verentis/office-(?:editor|backend)@sha256:[a-f0-9]{64}$`).test(env[name] ?? '') ||
            !env[name].includes(`office-${name === 'EDITOR_IMAGE' ? 'editor' : 'backend'}@`))
            throw new Error(`Invalid ${name}: expected Office ACR manifest digest`);
    }
    const params = '--o:ssl.enable=false --o:ssl.termination=true ' +
        '--o:ssl.ssl_verification=true ' +
        '--o:server_name=office-code.apps.verentis.dev --o:net.proto=IPv4 ' +
        '--o:logging.level=warning --o:logging.anonymize.anonymize_user_data=true ' +
        '--o:home_mode.enable=true';
    const substitutions = {
        __NAMESPACE__: 'verentis-apps',
        __EDITOR_IMAGE__: env.EDITOR_IMAGE,
        __BACKEND_IMAGE__: env.BACKEND_IMAGE,
        __CODE_IMAGE__: `${lock.repository}:${lock.tag}@${lock.digest}`,
        __CLIENT_ID__: env.OFFICE_CLIENT_ID,
        __BACKEND_SECRET__: env.OFFICE_BACKEND_SECRET,
        __STATE_PVC__: env.OFFICE_STATE_PVC,
        __PLATFORM_ORIGIN__: env.OFFICE_PLATFORM_ORIGIN,
        __CODE_PARAMS__: params,
        __CODE_FRAME_POLICY__: '--o:net.content_security_policy=frame-ancestors https://office.apps.verentis.dev;'
    };
    const documents = parseAllDocuments(readFileSync(new URL('k8s/office.yaml', root), 'utf8'));
    if (documents.some(doc => doc.errors.length)) throw new Error('Invalid k8s/office.yaml');
    const replace = value => {
        if (typeof value === 'string' && Object.hasOwn(substitutions, value)) return substitutions[value];
        if (Array.isArray(value)) return value.map(replace);
        if (value && typeof value === 'object') return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, replace(entry)]));
        return value;
    };
    const objects = documents.map(doc => replace(doc.toJS()));
    if (/__[A-Z_]+__/.test(JSON.stringify(objects))) throw new Error('Unrendered deployment token');
    return objects.map(object => stringify(object)).join('---\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        if (process.argv[2] === '--validate') {
            validate(process.env);
            console.log('Sprint deployment inputs and CODE lock validated.');
        } else if (process.argv.length === 2) {
            process.stdout.write(renderSprint(process.env));
        } else {
            throw new Error('Usage: node scripts/render-sprint.mjs [--validate]');
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
