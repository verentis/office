import assert from 'node:assert/strict';
import { readFileSync, rmSync, statSync } from 'node:fs';
import test from 'node:test';
import { parse, parseAllDocuments } from 'yaml';
import { renderOffice } from '../../scripts/render-office.mjs';
import { render } from '../../deploy/render.mjs';
import { provisionProofKey } from '../../scripts/proof-key.mjs';
import { checkPrerequisites } from '../../scripts/check-prerequisites.mjs';

const target = (suffix = '', domain = 'apps.feature.verentis.dev', origin = 'https://api.feature.verentis.dev') => ({
    IMAGE: `acrfeature.azurecr.io/verentis/office-editor@sha256:${'a'.repeat(64)}`,
    APP_NAME: `office${suffix}`, HOST: `office${suffix}.${domain}`, HOST_SUFFIX: suffix,
    APPS_DOMAIN: domain, NAMESPACE: 'verentis-apps', TLS_SECRET: 'apps-wildcard-tls', PLATFORM_ORIGIN: origin
});
const env = target();
const lock = JSON.parse(readFileSync(new URL('../../deploy/code.lock.json', import.meta.url)));
const delivery = JSON.parse(readFileSync(new URL('../../.github/verentis-delivery.json', import.meta.url))).hosted;
const renderObjects = values => parseAllDocuments(renderOffice(values)).map(doc => doc.toJS());
const objects = renderObjects(env);
const find = (items, kind, name) => items.find(item => item.kind === kind && item.metadata.name === name);
const resource = (kind, name) => find(objects, kind, name);
const container = name => resource('Deployment', name).spec.template.spec.containers[0];
const variable = (name, key) => container(name).env.find(entry => entry.name === key);

test('delivery ships only the wrapper image and hands the proof key to pre-deploy alone', () => {
    assert.equal(delivery.length, 1);
    const [office] = delivery;
    assert.equal(office.name, 'office');
    assert.equal(office.image, 'verentis/office-editor');
    assert.equal(office.dockerfile, 'deploy/editor.Dockerfile');
    assert.equal(office.render, 'node scripts/render-office.mjs');
    assert.deepEqual(office.secrets, ['CODE_PROOF_KEY']);
    assert.deepEqual(office.deployments, ['office-code', 'office-editor']);
    assert.deepEqual(office.health, [
        { host: 'office', path: '/_ready' },
        { host: 'office-code', path: '/hosting/discovery' }
    ]);
    const steps = office['pre-deploy'].split(' && ');
    assert.deepEqual(steps, [
        'node scripts/verify-code-lock.mjs',
        'node scripts/provision-code-proof.mjs "$NAMESPACE"',
        'node scripts/check-prerequisites.mjs "$NAMESPACE"'
    ]);
    const workflow = file => parse(readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8'));
    const pullRequest = workflow('pull-request.yml');
    assert.equal(pullRequest.jobs.delivery.uses, 'verentis/.github/.github/workflows/app-pull-request.yml@main');
    assert.equal(pullRequest.jobs.delivery.secrets, 'inherit');
    assert.equal(pullRequest.jobs.checks.uses, './.github/workflows/checks.yml');
    assert.equal(pullRequest.jobs.delivery.needs, 'checks', 'no preview ships before the repository checks pass');
    const release = workflow('release.yml');
    assert.deepEqual(Object.keys(release.jobs), ['delivery'], 'tests belong to the pull request, not the release');
    assert.equal(release.jobs.delivery.uses, 'verentis/.github/.github/workflows/app-release.yml@main');
    assert.equal(release.jobs.delivery.secrets, 'inherit');
    assert.equal(release.jobs.delivery.needs, undefined);
    const checks = parse(readFileSync(new URL('../../.github/workflows/checks.yml', import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(checks.on).sort(), ['workflow_call', 'workflow_dispatch']);
});

test('only editor and CODE are exposed on the platform wildcard certificate; WOPI names the target platform API', () => {
    assert.equal(renderOffice({ ...env, CODE_PROOF_KEY: 'must-not-enter-rendered-artifacts' }), renderOffice(env));
    assert.equal(objects.length, 6);
    for (const object of objects) assert.equal(object.metadata.namespace, env.NAMESPACE);
    assert.equal(resource('Deployment', 'office-wopi'), undefined);
    assert.equal(resource('Deployment', 'office-editor').spec.replicas, 2);
    assert.equal(resource('Deployment', 'office-code').spec.replicas, 1);
    for (const name of ['office-editor', 'office-code']) {
        const ingress = resource('Ingress', name);
        assert.equal(resource('Service', name).spec.type, 'ClusterIP');
        assert.equal(ingress.spec.ingressClassName, 'nginx');
        assert.equal(ingress.spec.tls[0].hosts[0], ingress.spec.rules[0].host);
        assert.equal(ingress.spec.tls[0].secretName, env.TLS_SECRET);
        assert.equal(ingress.metadata.annotations['cert-manager.io/cluster-issuer'], undefined);
        assert.equal(ingress.metadata.annotations['nginx.ingress.kubernetes.io/enable-access-log'], 'false');
    }
    assert.equal(resource('Ingress', 'office-editor').spec.rules[0].host, 'office.apps.feature.verentis.dev');
    assert.equal(resource('Ingress', 'office-code').spec.rules[0].host, 'office-code.apps.feature.verentis.dev');
    const codePaths = resource('Ingress', 'office-code').spec.rules[0].http.paths;
    assert.equal(codePaths[0].path, '/browser');
    assert.equal(codePaths[0].backend.service.name, 'office-editor');
    assert.equal(codePaths[1].backend.service.name, 'office-code');
    assert.equal(container('office-editor').image, env.IMAGE);
    assert.equal(container('office-code').image, `${lock.repository}:${lock.tag}@${lock.digest}`);
    assert.match(variable('office-code', 'extra_params').value, /ssl\.ssl_verification=true/);
    assert.doesNotMatch(variable('office-code', 'extra_params').value, /ssl\.ssl_verification=false/);
    assert.match(variable('office-code', 'extra_params').value, / --o:server_name=office-code\.apps\.feature\.verentis\.dev /);
    assert.equal(variable('office-code', 'aliasgroup1').value, 'https://api.feature.verentis.dev:443');
    assert.equal(container('office-code').args.at(-1),
        '--o:net.content_security_policy=frame-ancestors https://office.apps.feature.verentis.dev https://*.feature.verentis.dev;');
    assert.equal(container('office-code').command, undefined);
    assert.equal(container('office-code').args.length, 1);
    const codeSecurity = resource('Deployment', 'office-code').spec.template.spec.securityContext;
    assert.equal(codeSecurity.runAsUser, 1001);
    assert.equal(codeSecurity.runAsNonRoot, true);
    assert.equal(codeSecurity.fsGroup, 1001);
    const proof = resource('Deployment', 'office-code').spec.template.spec.volumes.find(volume => volume.name === 'proof');
    assert.equal(proof.secret.secretName, 'office-code-proof');
    assert.equal(proof.secret.defaultMode, 0o440);
    assert.deepEqual(container('office-code').volumeMounts.find(mount => mount.name === 'proof'),
        { name: 'proof', mountPath: '/etc/coolwsd/proof_key', subPath: 'proof_key', readOnly: true });
    assert.equal(variable('office-editor', 'NUXT_COLLABORATION_URL').value, env.PLATFORM_ORIGIN);
    assert.equal(variable('office-editor', 'NUXT_PUBLIC_WOPI_ORIGIN').value, env.PLATFORM_ORIGIN);
    assert.equal(variable('office-editor', 'NUXT_CODE_URL').value, 'http://office-code:9980');
    assert.equal(variable('office-editor', 'NUXT_PUBLIC_WRAPPER_ORIGIN').value, 'https://office.apps.feature.verentis.dev');
    assert.equal(variable('office-editor', 'NUXT_PUBLIC_EDITOR_ORIGIN').value, 'https://office-code.apps.feature.verentis.dev');
    assert.equal(container('office-editor').volumeMounts, undefined);
});

test('previews suffix every name and host but share the namespace proof key read-only', () => {
    const preview = renderObjects(target('-pr-12'));
    assert.deepEqual(preview.map(object => object.metadata.name).sort(), [
        'office-code-pr-12', 'office-code-pr-12', 'office-code-pr-12',
        'office-editor-pr-12', 'office-editor-pr-12', 'office-editor-pr-12'
    ]);
    for (const name of ['office-editor-pr-12', 'office-code-pr-12']) {
        const deployment = find(preview, 'Deployment', name);
        assert.deepEqual(deployment.spec.selector.matchLabels, { app: name });
        assert.deepEqual(deployment.spec.template.metadata.labels, { app: name });
        assert.deepEqual(find(preview, 'Service', name).spec.selector, { app: name });
    }
    const code = find(preview, 'Ingress', 'office-code-pr-12').spec.rules[0];
    assert.equal(code.host, 'office-code-pr-12.apps.feature.verentis.dev');
    assert.deepEqual(code.http.paths.map(path => path.backend.service.name), ['office-editor-pr-12', 'office-code-pr-12']);
    assert.equal(find(preview, 'Ingress', 'office-editor-pr-12').spec.rules[0].host, 'office-pr-12.apps.feature.verentis.dev');
    const codeDeployment = find(preview, 'Deployment', 'office-code-pr-12').spec.template.spec;
    assert.equal(codeDeployment.volumes.find(volume => volume.name === 'proof').secret.secretName, 'office-code-proof');
    assert.equal(codeDeployment.containers[0].args[0],
        '--o:net.content_security_policy=frame-ancestors https://office-pr-12.apps.feature.verentis.dev https://*.feature.verentis.dev;');
    const editor = find(preview, 'Deployment', 'office-editor-pr-12').spec.template.spec.containers[0].env;
    assert.equal(editor.find(entry => entry.name === 'NUXT_CODE_URL').value, 'http://office-code-pr-12:9980');

    const production = renderObjects(target('', 'apps.verentis.io', 'https://api.nz.verentis.io'));
    const productionCode = find(production, 'Deployment', 'office-code').spec.template.spec.containers[0];
    assert.equal(productionCode.env.find(entry => entry.name === 'aliasgroup1').value, 'https://api.nz.verentis.io:443');
    assert.equal(productionCode.args[0],
        '--o:net.content_security_policy=frame-ancestors https://office.apps.verentis.io https://*.verentis.io;');
});

test('mismatched targets, mutable images and bad CODE pins fail closed', () => {
    for (const key of ['IMAGE', 'APP_NAME', 'HOST', 'APPS_DOMAIN', 'NAMESPACE', 'TLS_SECRET', 'PLATFORM_ORIGIN'])
        assert.throws(() => renderOffice({ ...env, [key]: '' }), new RegExp(key));
    for (const origin of [
        'http://api.feature.verentis.dev', 'https://api.feature.verentis.dev/',
        'https://api.feature.verentis.dev:443', 'not-a-url', 'https://api.feature.verentis.dev/path',
        'https://api.feature.verentis.dev?query=1', 'https://api.feature.verentis.dev#fragment',
        'https://user@api.feature.verentis.dev', 'https://api.FEATURE.verentis.dev', ' https://api.feature.verentis.dev',
        'https://api.verentis.io', 'https://feature.verentis.dev.evil.invalid'
    ]) assert.throws(() => renderOffice({ ...env, PLATFORM_ORIGIN: origin }), /PLATFORM_ORIGIN/);
    assert.throws(() => renderOffice({ ...env, IMAGE: 'office-editor:latest' }), /IMAGE/);
    assert.throws(() => renderOffice({ ...env, IMAGE: `acrfeature.azurecr.io/verentis/other@sha256:${'a'.repeat(64)}` }), /IMAGE/);
    assert.throws(() => renderOffice({ ...env, HOST_SUFFIX: '-pr-0' }), /HOST_SUFFIX/);
    assert.throws(() => renderOffice({ ...env, HOST_SUFFIX: '-pr-1' }), /APP_NAME/);
    assert.throws(() => renderOffice({ ...env, HOST: 'office.apps.verentis.io' }), /HOST/);
    assert.throws(() => renderOffice({ ...env, APPS_DOMAIN: 'feature.verentis.dev', HOST: 'office.feature.verentis.dev' }), /APPS_DOMAIN/);
    assert.throws(() => renderOffice(env, { ...lock, digest: 'sha256:bad' }), /CODE image/);
    assert.throws(() => renderOffice(env, { ...lock, repository: 'evil.invalid/code' }), /CODE image/);
});

test('regional render keeps strict HTTPS and proof isolation', () => {
    const config = {
        region: 'eu-test', dataRegion: 'eu-test', editorImage: env.IMAGE,
        platformOrigin: env.PLATFORM_ORIGIN, editorOrigin: 'https://office.example.invalid',
        codeOrigin: 'https://code.example.invalid', proofKeyFile: '/operator/office/proof_key'
    };
    const result = render(config);
    assert.deepEqual(Object.keys(result.services), ['editor', 'code']);
    assert.equal(result.services.code.environment.aliasgroup1, `${config.platformOrigin}:443`);
    assert.equal(result.services.editor.environment.NUXT_PUBLIC_WOPI_ORIGIN, config.platformOrigin);
    assert.equal(result.services.editor.volumes, undefined);
    assert.equal(result.services.code.user, '1001:1001');
    assert.equal(result.services.code.entrypoint, undefined);
    assert.equal(result.services.code.command.length, 1);
    assert.equal(result.services.code.volumes[0].target, '/etc/coolwsd/proof_key');
    assert.equal(result.services.code.volumes[0].read_only, true);
    assert.throws(() => render({ ...config, dataRegion: 'other' }));
    assert.throws(() => render({ ...config, platformOrigin: 'http://api.example.invalid' }));
    assert.throws(() => render({ ...config, platformOrigin: 'https://api.example.invalid/path' }));
});

test('proof key persists across restart and rotation requires drained sessions', () => {
    const directory = new URL(`../../artifacts/proof-test-${process.pid}/`, import.meta.url);
    const path = new URL('proof_key', directory).pathname;
    try {
        const current = provisionProofKey(path);
        assert.equal(provisionProofKey(path), current);
        assert.equal(statSync(path).mode & 0o777, 0o600);
        assert.throws(() => provisionProofKey(path, true), /Drain CODE/);
        assert.notEqual(provisionProofKey(path, true, true), current);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('all deployment paths bound CODE storage requests and suppress unsafe logging', () => {
    const regional = render({
        region: 'eu-test', dataRegion: 'eu-test', editorImage: env.IMAGE,
        platformOrigin: env.PLATFORM_ORIGIN, editorOrigin: 'https://office.example.invalid',
        codeOrigin: 'https://code.example.invalid', proofKeyFile: '/operator/office/proof_key'
    }).services.code;
    const hostedEnvironment = Object.fromEntries(container('office-code').env.map(entry => [entry.name, entry.value]));
    for (const environment of [regional.environment, hostedEnvironment]) {
        const options = environment.extra_params.split(/\s+/);
        for (const setting of [
            'net.connection_timeout_secs=120',
            'logging.level=none', 'logging.level_startup=none',
            'logging.most_verbose_level_settable_from_client=none',
            'logging.least_verbose_level_settable_from_client=none',
            'browser_logging=false', 'logging.protocol=false',
            'logging.file[@enable]=false', 'logging_ui_cmd.file[@enable]=false',
            'trace[@enable]=false', 'admin_console.enable=false',
            'logging.lokit_sal_log=-INFO-WARN', 'logging.anonymize.anonymize_user_data=true'
        ]) {
            const prefix = `--o:${setting.slice(0, setting.indexOf('='))}=`;
            assert.deepEqual(options.filter(option => option.startsWith(prefix)), [`--o:${setting}`]);
        }
        assert.equal(environment.SAL_LOG, '-INFO-WARN');
        for (const name of ['COOL_LOGFILE', 'COOL_LOGFILE_UICMD', 'COOL_TRACE_STARTUP'])
            assert.equal(Object.hasOwn(environment, name), false);
    }
    for (const args of [regional.command, container('office-code').args])
        assert.ok(args.every(arg => arg.startsWith('--o:net.content_security_policy=')));
});

test('cluster prerequisites fail closed on missing proof, legacy resources and unreadable cluster state', () => {
    const namespace = 'verentis-apps';
    const expected = [
        ['describe', 'secret', 'office-code-proof', '-n', namespace],
        ['get', 'deployment,service,ingress', 'office-wopi', '-n', namespace, '--ignore-not-found', '-o', 'name']
    ];
    const run = (responses, calls = []) => args => {
        calls.push(args);
        const response = responses[calls.length - 1];
        if (response instanceof Error) throw response;
        return response;
    };
    const valid = ['Data\n====\nproof_key:  1704 bytes\n', ''];
    const calls = [];
    assert.doesNotThrow(() => checkPrerequisites(namespace, run(valid, calls)));
    assert.deepEqual(calls, expected);
    assert.throws(() => checkPrerequisites('', run(valid)), /namespace/);
    for (const proof of ['', 'proof_key: 0 bytes\n', 'wrong_key: 1704 bytes\n'])
        assert.throws(() => checkPrerequisites(namespace, run([proof, ''])), /nonempty proof_key/);
    for (const resource of ['deployment.apps/office-wopi', 'service/office-wopi', 'ingress.networking.k8s.io/office-wopi'])
        assert.throws(() => checkPrerequisites(namespace, run([valid[0], resource])), /Remove the retired Office WOPI/);
    for (let index = 0; index < valid.length; index++) {
        const responses = [...valid];
        responses[index] = new Error('cluster read failed');
        assert.throws(() => checkPrerequisites(namespace, run(responses)), /Cannot verify/);
    }
});
