import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedMessage, childMessage, nextDirty, validateLaunch } from '../../apps/editor/shared/boundaries.mjs';

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
