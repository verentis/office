import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Renders k8s/office.yaml for one hosted-app target. Inputs are the shared deploy action's environment
// (IMAGE HOST APP_NAME HOST_SUFFIX APPS_DOMAIN NAMESPACE TLS_SECRET PLATFORM_ORIGIN); no npm dependencies.
const root = new URL('../', import.meta.url);
const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const dnsName = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const digest = /^sha256:[a-f0-9]{64}$/;
export const proofSecret = 'office-code-proof';

function requireInput(env, name, pattern) {
    const value = env[name];
    if (typeof value !== 'string' || !value || value !== value.trim() || (pattern && !pattern.test(value)))
        throw new Error(`Missing or invalid ${name}`);
    return value;
}

function exactHttpsOrigin(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error('Invalid PLATFORM_ORIGIN: expected an exact HTTPS origin');
    }
    if (url.protocol !== 'https:' || url.origin !== value || url.port || !dnsName.test(url.hostname))
        throw new Error('Invalid PLATFORM_ORIGIN: expected an exact HTTPS origin');
    return url;
}

export function targetSettings(env, lock = JSON.parse(readFileSync(new URL('deploy/code.lock.json', root)))) {
    const suffix = env.HOST_SUFFIX ?? '';
    if (suffix !== '' && !/^-pr-[1-9][0-9]{0,5}$/.test(suffix)) throw new Error('Invalid HOST_SUFFIX');
    const namespace = requireInput(env, 'NAMESPACE', dnsLabel);
    const tlsSecret = requireInput(env, 'TLS_SECRET', /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/);
    const appsDomain = requireInput(env, 'APPS_DOMAIN', dnsName);
    // Apps live at <name>.apps.<root>; workspaces at <workspace>.<root> (production verentis.io, feature.verentis.dev).
    if (!appsDomain.startsWith('apps.') || !appsDomain.slice(5).includes('.'))
        throw new Error('Invalid APPS_DOMAIN: expected apps.<platform root domain>');
    const platformRoot = appsDomain.slice(5);
    const appName = requireInput(env, 'APP_NAME');
    if (appName !== `office${suffix}`) throw new Error('APP_NAME must be office plus HOST_SUFFIX');
    if (requireInput(env, 'HOST') !== `${appName}.${appsDomain}`) throw new Error('HOST must be APP_NAME.APPS_DOMAIN');
    const image = requireInput(env, 'IMAGE', /^[a-z0-9.-]+(?::[0-9]+)?\/verentis\/office-editor@sha256:[a-f0-9]{64}$/);
    const platform = exactHttpsOrigin(requireInput(env, 'PLATFORM_ORIGIN'));
    if (!platform.hostname.endsWith(`.${platformRoot}`))
        throw new Error(`PLATFORM_ORIGIN must be a platform origin under ${platformRoot}`);
    if (lock.repository !== 'docker.io/collabora/code' || !/^\d+(?:\.\d+)+$/.test(lock.tag) || !digest.test(lock.digest))
        throw new Error('Invalid pinned CODE image in deploy/code.lock.json');
    const editorName = `office-editor${suffix}`;
    const codeName = `office-code${suffix}`;
    const editorHost = env.HOST;
    const codeHost = `office-code${suffix}.${appsDomain}`;
    return {
        namespace, tlsSecret, image, editorName, codeName, editorHost, codeHost,
        platformOrigin: platform.origin,
        workspaceOrigins: `https://*.${platformRoot}`,
        codeImage: `${lock.repository}:${lock.tag}@${lock.digest}`
    };
}

export function renderOffice(env, lock) {
    const target = targetSettings(env, lock);
    const params = '--o:ssl.enable=false --o:ssl.termination=true ' +
        '--o:ssl.ssl_verification=true ' +
        `--o:server_name=${target.codeHost} --o:net.proto=IPv4 ` +
        '--o:net.connection_timeout_secs=120 ' +
        '--o:logging.level=none --o:logging.level_startup=none ' +
        '--o:logging.most_verbose_level_settable_from_client=none ' +
        '--o:logging.least_verbose_level_settable_from_client=none ' +
        '--o:browser_logging=false --o:logging.protocol=false ' +
        '--o:logging.file[@enable]=false --o:logging_ui_cmd.file[@enable]=false ' +
        '--o:trace[@enable]=false --o:admin_console.enable=false ' +
        '--o:logging.lokit_sal_log=-INFO-WARN --o:logging.anonymize.anonymize_user_data=true ' +
        '--o:home_mode.enable=true';
    const substitutions = {
        NAMESPACE: target.namespace,
        EDITOR_NAME: target.editorName,
        CODE_NAME: target.codeName,
        EDITOR_HOST: target.editorHost,
        CODE_HOST: target.codeHost,
        TLS_SECRET: target.tlsSecret,
        PROOF_SECRET: proofSecret,
        EDITOR_IMAGE: target.image,
        CODE_IMAGE: target.codeImage,
        CODE_URL: `http://${target.codeName}:9980`,
        WRAPPER_ORIGIN: `https://${target.editorHost}`,
        CODE_ORIGIN: `https://${target.codeHost}`,
        PLATFORM_ORIGIN: target.platformOrigin,
        PLATFORM_ALLOWLIST: `${target.platformOrigin}:443`,
        CODE_PARAMS: params,
        // The /browser proxy narrows this to the wrapper and the exact embedding parent per request.
        CODE_FRAME_POLICY: `--o:net.content_security_policy=frame-ancestors https://${target.editorHost} ${target.workspaceOrigins};`
    };
    const template = readFileSync(new URL('k8s/office.yaml', root), 'utf8');
    const rendered = template.replace(/__([A-Z][A-Z0-9_]*)__/g, (token, name) => {
        if (!Object.hasOwn(substitutions, name)) throw new Error(`Unknown deployment token ${token}`);
        return JSON.stringify(substitutions[name]);
    });
    if (/__[A-Z][A-Z0-9_]*__/.test(rendered)) throw new Error('Unrendered deployment token');
    return rendered;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        if (process.argv.length !== 2) throw new Error('Usage: node scripts/render-office.mjs (inputs from the environment)');
        process.stdout.write(renderOffice(process.env));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
