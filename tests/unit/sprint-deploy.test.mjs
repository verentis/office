import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
    OFFICE_CLIENT_ID: id,
    EDITOR_IMAGE: `acrverentis.azurecr.io/verentis/office-editor@sha256:${'a'.repeat(64)}`,
    BACKEND_IMAGE: `acrverentis.azurecr.io/verentis/office-backend@sha256:${'b'.repeat(64)}`
};
const lock = JSON.parse(readFileSync(new URL('../../deploy/code.lock.json', import.meta.url)));
const workflow = parse(readFileSync(new URL('../../.github/workflows/deploy-sprint.yml', import.meta.url), 'utf8'));
const checks = parse(readFileSync(new URL('../../.github/workflows/checks.yml', import.meta.url), 'utf8'));
const objects = parseAllDocuments(renderSprint(env)).map(doc => doc.toJS());
const resource = (kind, name) => objects.find(item => item.kind === kind && item.metadata.name === name);
const container = name => resource('Deployment', name).spec.template.spec.containers[0];
const variable = (name, key) => container(name).env.find(entry => entry.name === key);

test('push targets sprint only and provisions the credential after checking the durable state', () => {
    assert.deepEqual(workflow.on.push.branches, ['feat/**']);
    assert.equal(workflow.on.workflow_dispatch, undefined);
    assert.equal(workflow.on.pull_request, undefined);
    assert.deepEqual(checks.on.push.branches, ['main', 'feat/**']);
    assert.equal(workflow.jobs.deploy.if, "github.repository == 'verentis/office'");
    assert.equal(workflow.jobs.deploy.environment, 'sprint');
    assert.equal(workflow.permissions['id-token'], 'write');
    const steps = workflow.jobs.deploy.steps;
    const index = text => steps.findIndex(step => (step.name ?? '').includes(text));
    assert.ok(index('Validate required') < index('Azure login'));
    assert.ok(index('Check Office package and backend') < index('Azure login'));
    assert.match(steps[index('Check Office package and backend')].run, /npm run check && npm run check:framing && dotnet test/);
    assert.ok(index('Verify CODE') > index('Validate required'));
    assert.ok(index('Verify CODE') < index('Build and push'));
    assert.ok(index('Check cluster prerequisites') < index('Build and push'));
    assert.ok(index('Provision Office backend credential') > index('Check cluster prerequisites'));
    assert.ok(index('Provision Office backend credential') < index('Build and push'));
    assert.ok(index('Recheck prerequisites') > index('Build and push backend'));
    const check = steps[index('Check cluster prerequisites')].run;
    assert.match(check, /status\.phase!=="Bound"/);
    assert.match(check, /kubectl get namespace verentis-apps/);
    assert.match(check, /kubectl get pvc office-state/);
    assert.doesNotMatch(check, /kubectl (create|apply).*namespace|kubectl get secret.*-o json/);
    const provision = steps[index('Provision Office backend credential')];
    assert.equal(provision.env.OFFICE_CLIENT_SECRET, '${{ secrets.OFFICE_CLIENT_SECRET }}');
    assert.match(provision.run, /printf '%s' "\$OFFICE_CLIENT_SECRET" \|/);
    assert.match(provision.run, /--from-file=ClientSecret=\/dev\/stdin --dry-run=client -o yaml \|/);
    assert.match(provision.run, /kubectl apply -f -/);
    assert.doesNotMatch(provision.run, /--from-literal|echo "\$OFFICE_CLIENT_SECRET"|set -x/);
    assert.equal(steps[index('Validate required')].env.OFFICE_CLIENT_SECRET, '${{ secrets.OFFICE_CLIENT_SECRET }}');
    assert.match(steps[index('Validate required')].run, /\[\[ "\$OFFICE_CLIENT_SECRET" =~ \^vab_\[A-Za-z0-9_-\]\{43\}\$ \]\]/);
    assert.equal(workflow.jobs.deploy.env.OFFICE_CLIENT_SECRET, undefined);
    assert.doesNotMatch(JSON.stringify(workflow), /OFFICE_BACKEND_SECRET/);
    assert.equal(workflow.jobs.deploy.env.OFFICE_STATE_PVC, undefined);
    assert.match(steps[index('Recheck prerequisites')].run, /kubectl describe secret office-backend-auth/);
    assert.match(steps[index('Recheck prerequisites')].run, /grep -Eq '\^ClientSecret:/);
    assert.match(steps[index('Recheck prerequisites')].run, /kubectl rollout status/);
    assert.match(steps[index('Recheck prerequisites')].run, /certificate\/"\$name"-tls/);
    assert.match(steps[index('Recheck prerequisites')].run, /h\.draining!==false/);
    assert.doesNotMatch(JSON.stringify(workflow), /uat\.verentis|production\.yaml|manifests\/environments/);
    for (const name of [
        'AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID',
        'ACR_NAME', 'ACR_LOGIN_SERVER', 'AKS_CLUSTER_NAME', 'AKS_RESOURCE_GROUP',
        'OFFICE_PLATFORM_ORIGIN', 'OFFICE_CLIENT_ID'
    ]) {
        assert.equal(workflow.jobs.deploy.env[name], '${{ secrets.' + name + ' }}');
    }
    for (const name of ['AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID'])
        assert.equal(steps[index('Azure login')]['with'][name.slice('AZURE_'.length).toLowerCase().replaceAll('_', '-')],
            '${{ secrets.' + name + ' }}');
    assert.doesNotMatch(JSON.stringify(workflow), /\$\{\{\s*vars\./);
});

test('three HTTPS origins, strict callbacks, pinned CODE and single persistent writer survive pod recreation', () => {
    assert.equal(objects.length, 9);
    for (const name of ['office-editor', 'office-code', 'office-wopi']) {
        const service = resource('Service', name);
        const ingress = resource('Ingress', name);
        assert.equal(service.spec.type, 'ClusterIP');
        assert.equal(ingress.spec.ingressClassName, 'nginx');
        assert.equal(ingress.spec.tls[0].hosts[0], ingress.spec.rules[0].host);
        assert.equal(ingress.spec.rules[0].http.paths.at(-1).backend.service.name, name);
        assert.equal(ingress.metadata.annotations['nginx.ingress.kubernetes.io/enable-access-log'], 'false');
        assert.equal(ingress.metadata.annotations['cert-manager.io/cluster-issuer'], 'letsencrypt-prod');
        assert.equal(resource('Deployment', name).metadata.namespace, 'verentis-apps');
    }
    assert.equal(resource('Ingress', 'office-editor').spec.rules[0].host, 'office.apps.verentis.dev');
    assert.equal(resource('Ingress', 'office-code').spec.rules[0].host, 'office-code.apps.verentis.dev');
    assert.equal(resource('Ingress', 'office-wopi').spec.rules[0].host, 'office-wopi.apps.verentis.dev');
    const codePaths = resource('Ingress', 'office-code').spec.rules[0].http.paths;
    assert.equal(codePaths[0].path, '/browser');
    assert.equal(codePaths[0].backend.service.name, 'office-editor');
    assert.equal(codePaths[1].backend.service.name, 'office-code');
    assert.equal(container('office-code').image, `${lock.repository}:${lock.tag}@${lock.digest}`);
    assert.match(variable('office-code', 'extra_params').value, /ssl\.ssl_verification=true/);
    assert.doesNotMatch(variable('office-code', 'extra_params').value, /ssl\.ssl_verification=false/);
    assert.equal(variable('office-code', 'aliasgroup1').value, 'https://office-wopi.apps.verentis.dev:443');
    assert.equal(container('office-code').args[0], '--o:net.content_security_policy=frame-ancestors https://office.apps.verentis.dev;');
    assert.equal(variable('office-editor', 'NUXT_PUBLIC_SYNTHETIC_ONLY').value, 'false');
    assert.equal(variable('office-editor', 'NUXT_BACKEND_URL').value, 'http://office-wopi:8080');
    assert.equal(variable('office-editor', 'NUXT_CODE_URL').value, 'http://office-code:9980');
    assert.equal(variable('office-editor', 'NUXT_PUBLIC_PARENT_ORIGINS'), undefined);
    assert.equal(workflow.jobs.deploy.env.OFFICE_PARENT_ORIGINS, undefined);
    assert.equal(variable('office-wopi', 'Office__PlatformOrigin').value, env.OFFICE_PLATFORM_ORIGIN);
    assert.equal(variable('office-wopi', 'Office__DelegationAuthMode').value, 'oauth');
    assert.deepEqual(variable('office-wopi', 'Office__ClientSecret').valueFrom.secretKeyRef,
        { name: 'office-backend-auth', key: 'ClientSecret', optional: false });
    const backend = resource('Deployment', 'office-wopi').spec;
    assert.equal(backend.replicas, 1);
    assert.equal(backend.strategy.type, 'Recreate');
    assert.equal(backend.template.spec.volumes[0].persistentVolumeClaim.claimName, 'office-state');
    assert.equal(variable('office-wopi', 'DataDirectory').value, '/data');
    assert.equal(container('office-wopi').volumeMounts[0].mountPath, '/data');
    assert.equal(backend.template.spec.initContainers[0].volumeMounts[0].mountPath, '/data');
    assert.equal(container('office-wopi').readinessProbe.httpGet.path, '/health');
});

test('missing settings, wrong environment, mutable images and bad CODE pin fail closed', () => {
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
    assert.deepEqual(validate({
        ...env,
        OFFICE_PLATFORM_ORIGIN: 'https://api.sprint-10.verentis.dev'
    }), 'sprint-10');
    for (const image of ['office-editor:latest', `${env.ACR_LOGIN_SERVER}/verentis/office-editor:sha-tag`, env.BACKEND_IMAGE])
        assert.throws(() => renderSprint({ ...env, EDITOR_IMAGE: image }), /EDITOR_IMAGE/);
    assert.throws(() => renderSprint(env, { ...lock, digest: 'sha256:bad' }), /CODE image/);
    assert.throws(() => renderSprint(env, { ...lock, repository: 'evil.invalid/code' }), /CODE image/);
});

test('deployment rejects a Kubernetes Secret name in place of the issued credential', () => {
    const command = workflow.jobs.deploy.steps.find(step => step.name === 'Validate required sprint settings and CODE pin').run;
    const options = { cwd: new URL('../../', import.meta.url), env: { ...process.env, ...env } };
    assert.throws(
        () => execFileSync('bash', ['-c', command], {
            ...options, env: { ...options.env, OFFICE_CLIENT_SECRET: 'office-backend-auth' }
        }),
        error => error.status === 1 && error.stdout.toString().includes('OFFICE_CLIENT_SECRET must be the issued publisher client secret value')
    );
    assert.match(execFileSync('bash', ['-c', command], {
        ...options, env: { ...options.env, OFFICE_CLIENT_SECRET: `vab_${'A'.repeat(43)}` }
    }).toString(), /Sprint deployment inputs and CODE lock validated/);
});
