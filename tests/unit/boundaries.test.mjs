import { test } from 'node:test';
import assert from 'node:assert/strict';
import formats from '../../apps/editor/shared/formats.json' with { type: 'json' };
import { isTrustedMessage, parseParentOrigins, isTrustedParentMessage, childMessage, nextDirty, validateLaunch, validateLiveLaunch, saveConfirmed } from '../../apps/editor/shared/boundaries.mjs';

test('workspace selection allows only explicitly configured parent origins', () => {
    const allowed = parseParentOrigins('https://one.localtest.me,https://two.localtest.me');
    const source = {};
    assert.equal(isTrustedParentMessage({ source, origin: allowed[1] }, source, allowed, ''), true);
    assert.equal(isTrustedParentMessage({ source: {}, origin: allowed[1] }, source, allowed, ''), false);
    assert.equal(isTrustedParentMessage({ source, origin: allowed[1] }, source, allowed, allowed[0]), false);
    for (const origin of ['', 'https://evil.invalid', 'https://one.localtest.me.evil.invalid', 'http://one.localtest.me']) {
        assert.equal(isTrustedParentMessage({ source, origin }, source, allowed, ''), false);
    }
    for (const invalid of ['*', 'https://*.localtest.me', 'http://one.localtest.me', 'https://one.localtest.me/path',
        'https://user:password@one.localtest.me', 'https://one.localtest.me/#fragment']) {
        assert.throws(() => parseParentOrigins(invalid));
    }
    assert.throws(() => parseParentOrigins(''));
});

test('parent and nested child source/origin boundaries remain independent', () => {
    const parent = {}, child = {};
    const event = { source: child, origin: 'https://code.localhost:8443', data: '{"MessageId":"Doc_ModifiedStatus","Values":{"Modified":true}}' };
    assert.equal(isTrustedMessage(event, parent, 'https://host.localhost:8443'), false);
    assert.equal(childMessage({ ...event, source: parent }, child, event.origin), null);
    assert.equal(childMessage({ ...event, origin: 'https://evil.invalid' }, child, event.origin), null);
    assert.equal(childMessage({ ...event, data: 'not-json' }, child, event.origin), null);
    assert.equal(childMessage(event, child, event.origin).MessageId, 'Doc_ModifiedStatus');
});
test('loading, unacknowledged save and CODE saved messages cannot clear dirty', () => {
    assert.equal(nextDirty(false, { MessageId: 'Doc_ModifiedStatus', Values: { Modified: true } }), true);
    for (const message of [
        { MessageId: 'App_LoadingStatus', Values: { Status: 'Document_Loaded' } },
        { MessageId: 'Doc_ModifiedStatus', Values: { Modified: false } },
        { MessageId: 'Action_Save_Resp', Values: { success: true } }
    ]) assert.equal(nextDirty(true, message), true);
});
test('launch rejects arbitrary URL, origin, scope, lifetime and identity', () => {
    const editor = 'https://code.localhost:8443', wopi = 'https://wopi.localhost:8443', id = 'a'.repeat(32);
    const source = `${wopi}/wopi/synthetic/main/files/${id}`;
    const launch = { action: `${editor}/browser/abc/cool.html?WOPISrc=${encodeURIComponent(source)}`, accessToken: 'a'.repeat(43), accessTokenTtl: Date.now() + 60000, fileId: id, format: 'docx', editorOrigin: editor, wopiSource: source, syntheticOnly: true };
    assert.equal(validateLaunch(launch, editor, wopi), launch);
    for (const change of [
        { action: launch.action.replace('code.localhost', 'evil.invalid') }, { accessTokenTtl: 0 },
        { accessToken: 'verentis-token' }, { fileId: '../file' }, { syntheticOnly: false }, { format: 'exe' },
        { wopiSource: source.replace('/main/', '/other/') }, { editorOrigin: wopi },
        { action: launch.action + '&WOPISrc=evil' }, { action: launch.action.replace('/browser/abc/cool.html', '/elsewhere') }
    ]) assert.throws(() => validateLaunch({ ...launch, ...change }, editor, wopi));
});

test('live launch binds exact host context without trusting backend navigation', () => {
    const editor = 'https://code.example', wopi = 'https://wopi.example';
    const context = { workspace: { id: 'workspace' }, file: { nodeId: 'node', branch: 'main' } };
    const source = `${wopi}/wopi/workspace/6D61696E/files/node`;
    const value = {
        syntheticOnly: false, fileId: 'node', sessionId: 'a'.repeat(32), statusCredential: 'b'.repeat(43),
        accessToken: 'c'.repeat(43), accessTokenTtl: Date.now() + 60_000, readOnly: true, format: 'xlsx',
        action: `${editor}/browser/abc/cool.html?WOPISrc=${encodeURIComponent(source)}`,
        editorOrigin: editor, wopiSource: source
    };
    assert.equal(validateLiveLaunch(value, editor, wopi, context), value);
    for (const [format, definition] of Object.entries(formats)) {
        assert.equal(validateLiveLaunch({ ...value, format }, editor, wopi, context).format, format);
        if (definition.mode === 'view')
            assert.throws(() => validateLiveLaunch({ ...value, format, readOnly: false }, editor, wopi, context));
        else
            assert.equal(validateLiveLaunch({ ...value, format, readOnly: false }, editor, wopi, context).readOnly, false);
    }
    for (const change of [
        { fileId: 'other' }, { syntheticOnly: true }, { accessTokenTtl: Date.now() + 9 * 3600_000 },
        { statusCredential: 'not-a-credential' }, { readOnly: undefined }, { format: 'exe' }, { format: '__proto__' },
        { wopiSource: source.replace('workspace', 'other') }, { action: value.action.replace('code.example', 'untrusted.example') }
    ]) assert.throws(() => validateLiveLaunch({ ...value, ...change }, editor, wopi, context));
    assert.throws(() => validateLiveLaunch(value, editor, wopi, { ...context, file: { nodeId: 'node', branch: 'other' } }));
});

test('only a matching durable snapshot receipt with no later edits clears dirty', () => {
    const request = { correlation: 'save-2', generation: 2 };
    const result = { state: 'ready', revision: 'opaque-r', receipt: { ...request, revision: 'opaque-r' } };
    assert.equal(saveConfirmed(result, request, 2, false), true);
    assert.equal(saveConfirmed(result, request, 3, false), false);
    assert.equal(saveConfirmed(result, request, 2, true), false);
    for (const change of [
        { receipt: null }, { state: 'conflict' }, { revision: 'external-winner' },
        { receipt: { ...result.receipt, correlation: 'earlier-save' } },
        { receipt: { ...result.receipt, generation: 1 } }
    ]) assert.equal(saveConfirmed({ ...result, ...change }, request, 2, false), false);
});
