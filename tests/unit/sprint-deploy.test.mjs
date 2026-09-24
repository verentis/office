import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse, parseAllDocuments } from 'yaml';
import { renderSprint, validate } from '../../scripts/render-sprint.mjs';

const id = '12345678-1234-4234-8234-123456789abc';
const env = {
    AZURE_CLIENT_ID: id, AZURE_TENANT_ID: id, AZURE_SUBSCRIPTION_ID: id,
    ACR_NAME: 'acrverentis', ACR_LOGIN_SERVER: 'acrverentis.azurecr.io',
    AKS_CLUSTER_NAME: 'aks-verentis-dev-southafricanorth',
    AKS_RESOURCE_GROUP: 'rg-verentis-platform-dev-southafricanorth',
    OFFICE_PLATFORM_ORIGIN: 'https://api.sprint-9.verentis.dev',
    OFFICE_PARENT_ORIGINS: 'https://one.sprint-9.verentis.dev,https://two.sprint-9.verentis.dev',
    OFFICE_CLIENT_ID: id, OFFICE_BACKEND_SECRET: 'office-backend-auth',
    OFFICE_STATE_PVC: 'office-state',
    EDITOR_IMAGE: `acrverentis.azurecr.io/verentis/office-editor@sha256:${'a'.repeat(64)}`,
    BACKEND_IMAGE: `acrverentis.azurecr.io/verentis/office-backend@sha256:${'b'.repeat(64)}`
};
const lock = JSON.parse(readFileSync(new URL('../../deploy/code.lock.json', import.meta.url)));
const workflow = parse(readFileSync(new URL('../../.github/workflows/deploy-sprint.yml', import.meta.url), 'utf8'));
const objects = parseAllDocuments(renderSprint(env)).map(doc => doc.toJS());
const resource = (kind, name) => objects.find(item => item.kind === kind && item.metadata.name === name);
const container = name => resource('Deployment', name).spec.template.spec.containers[0];
const variable = (name, key) => container(name).env.find(entry => entry.name === key);

test('push targets sprint only and blocks missing cluster, PVC and backend secret before build/apply', () => {
    assert.deepEqual(workflow.on.push.branches, ['main']);
    assert.equal(workflow.on.workflow_dispatch, undefined);
    assert.equal(workflow.permissions['id-token'], 'write');
    const steps = workflow.jobs.deploy.steps;
    const index = text => steps.findIndex(step => (step.name ?? '').includes(text));
    assert.ok(index('Validate required') < index('Azure login'));
    assert.ok(index('Check Office package and backend') < index('Azure login'));
    assert.match(steps[index('Check Office package and backend')].run, /npm run check && dotnet test/);
    assert.ok(index('Verify CODE') > index('Validate required'));
    assert.ok(index('Verify CODE') < index('Build and push'));
    assert.ok(index('Check cluster prerequisites') < index('Build and push'));
    assert.ok(index('Recheck prerequisites') > index('Build and push backend'));
    const check = steps[index('Check cluster prerequisites')].run;
    assert.match(check, /status\.phase!=="Bound"/);
    assert.match(check, /kubectl get namespace verentis-apps/);
    assert.match(check, /kubectl describe secret "\$OFFICE_BACKEND_SECRET"/);
    assert.match(check, /grep -Eq '\^ClientSecret:/);
    assert.doesNotMatch(check, /kubectl (create|apply).*namespace|kubectl get secret.*-o json/);
    assert.match(steps[index('Recheck prerequisites')].run, /kubectl rollout status/);
    assert.match(steps[index('Recheck prerequisites')].run, /certificate\/"\$name"-tls/);
    assert.match(steps[index('Recheck prerequisites')].run, /h\.draining!==false/);
    assert.doesNotMatch(JSON.stringify(workflow), /uat\.verentis|production\.yaml|manifests\/environments/);
    for (const name of ['ACR_NAME', 'ACR_LOGIN_SERVER', 'OFFICE_PLATFORM_ORIGIN', 'OFFICE_STATE_PVC', 'OFFICE_BACKEND_SECRET']) {
        assert.match(workflow.jobs.deploy.env[name], /vars\./);
    }
});

test('three HTTPS origins, strict callbacks, pinned CODE and single persistent writer survive pod recreation', () => {
    assert.equal(objects.length, 9);
    for (const name of ['office-editor', 'office-code', 'office-wopi']) {
        const service = resource('Service', name);
        const ingress = resource('Ingress', name);
        assert.equal(service.spec.type, 'ClusterIP');
        assert.equal(ingress.spec.ingressClassName, 'nginx');
        assert.equal(ingress.spec.tls[0].hosts[0], ingress.spec.rules[0].host);
        assert.equal(ingress.spec.rules[0].http.paths[0].backend.service.name, name);
        assert.equal(ingress.metadata.annotations['nginx.ingress.kubernetes.io/enable-access-log'], 'false');
        assert.equal(ingress.metadata.annotations['cert-manager.io/cluster-issuer'], 'letsencrypt-prod');
        assert.equal(resource('Deployment', name).metadata.namespace, 'verentis-apps');
    }
    assert.equal(resource('Ingress', 'office-editor').spec.rules[0].host, 'office.apps.verentis.dev');
    assert.equal(resource('Ingress', 'office-code').spec.rules[0].host, 'office-code.apps.verentis.dev');
    assert.equal(resource('Ingress', 'office-wopi').spec.rules[0].host, 'office-wopi.apps.verentis.dev');
    assert.equal(container('office-code').image, `${lock.repository}:${lock.tag}@${lock.digest}`);
    assert.match(variable('office-code', 'extra_params').value, /ssl\.ssl_verification=true/);
    assert.doesNotMatch(variable('office-code', 'extra_params').value, /ssl\.ssl_verification=false/);
    assert.equal(variable('office-code', 'aliasgroup1').value, 'https://office-wopi.apps.verentis.dev:443');
    assert.equal(container('office-code').args[0], '--o:net.content_security_policy=frame-ancestors https://office.apps.verentis.dev https://one.sprint-9.verentis.dev https://two.sprint-9.verentis.dev;');
    assert.equal(variable('office-editor', 'NUXT_PUBLIC_SYNTHETIC_ONLY').value, 'false');
    assert.equal(variable('office-editor', 'NUXT_BACKEND_URL').value, 'http://office-wopi:8080');
    assert.equal(variable('office-editor', 'NUXT_PUBLIC_PARENT_ORIGINS').value, env.OFFICE_PARENT_ORIGINS);
    assert.equal(variable('office-wopi', 'Office__PlatformOrigin').value, env.OFFICE_PLATFORM_ORIGIN);
    assert.deepEqual(variable('office-wopi', 'Office__ClientSecret').valueFrom.secretKeyRef,
        { name: env.OFFICE_BACKEND_SECRET, key: 'ClientSecret', optional: false });
    const backend = resource('Deployment', 'office-wopi').spec;
    assert.equal(backend.replicas, 1);
    assert.equal(backend.strategy.type, 'Recreate');
    assert.equal(backend.template.spec.volumes[0].persistentVolumeClaim.claimName, env.OFFICE_STATE_PVC);
    assert.equal(variable('office-wopi', 'DataDirectory').value, '/data');
    assert.equal(container('office-wopi').volumeMounts[0].mountPath, '/data');
    assert.equal(backend.template.spec.initContainers[0].volumeMounts[0].mountPath, '/data');
    assert.equal(container('office-wopi').readinessProbe.httpGet.path, '/health');
});

test('missing settings, wrong environment, unsafe origins, mutable images and bad CODE pin fail closed', () => {
    for (const key of Object.keys(env).filter(key => !key.endsWith('_IMAGE'))) {
        assert.throws(() => validate({ ...env, [key]: '' }), new RegExp(key));
    }
    for (const origin of [
        'https://api.uat.verentis.dev', 'https://api.verentis.dev', 'http://api.sprint-9.verentis.dev',
        'https://api.sprint-9.verentis.dev/', 'https://api.sprint-9.verentis.dev:443'
    ]) assert.throws(() => renderSprint({ ...env, OFFICE_PLATFORM_ORIGIN: origin }), /sprint platform/);
    for (const [name, value] of [
        ['AKS_CLUSTER_NAME', 'aks-verentis-production-nz'],
        ['AKS_RESOURCE_GROUP', 'rg-verentis-platform-production-nz'],
        ['AKS_RESOURCE_GROUP', 'rg-verentis-platform-dev-westus']
    ]) assert.throws(() => validate({ ...env, [name]: value }), /dev cluster location/);
    for (const origin of [
        '*', 'https://*.sprint-9.verentis.dev', 'https://one.uat.verentis.dev',
        'https://one.sprint-1.verentis.dev', 'https://one.sprint-9.verentis.dev/',
        'https://one.sprint-9.verentis.dev https://evil.invalid',
        'https://one.sprint-9.verentis.dev,'
    ]) assert.throws(() => renderSprint({ ...env, OFFICE_PARENT_ORIGINS: origin }), /PARENT_ORIGINS/);
    assert.deepEqual(validate({
        ...env,
        OFFICE_PLATFORM_ORIGIN: 'https://api.sprint-10.verentis.dev',
        OFFICE_PARENT_ORIGINS: 'https://one.sprint-10.verentis.dev'
    }), ['https://one.sprint-10.verentis.dev']);
    for (const image of ['office-editor:latest', `${env.ACR_LOGIN_SERVER}/verentis/office-editor:sha-tag`, env.BACKEND_IMAGE])
        assert.throws(() => renderSprint({ ...env, EDITOR_IMAGE: image }), /EDITOR_IMAGE/);
    assert.throws(() => renderSprint(env, { ...lock, digest: 'sha256:bad' }), /CODE image/);
    assert.throws(() => renderSprint(env, { ...lock, repository: 'evil.invalid/code' }), /CODE image/);
});
