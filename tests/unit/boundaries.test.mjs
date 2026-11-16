import { test } from 'node:test';
import assert from 'node:assert/strict';
import formats from '../../apps/editor/shared/formats.json' with { type: 'json' };
import { isTrustedMessage, parseParentOrigins, isTrustedParentMessage, isPotentialParentMessage, childMessage, nextDirty, validateLiveLaunch, validateLiveContinuation, isDerivedSaveResponse, editorReloadStarted, saveAsDraft, saveAsCommand, saveConfirmed, sessionStatusProblem } from '../../apps/editor/shared/boundaries.mjs';

test('live parent is pinned to the browser source and exact HTTPS origin', () => {
    const source = {};
    const event = { source, origin: 'https://custom.example.test' };
    assert.equal(isPotentialParentMessage(event, source, ''), true);
    assert.equal(isPotentialParentMessage(event, source, event.origin), true);
    assert.equal(isPotentialParentMessage(event, {}, ''), false);
    assert.equal(isPotentialParentMessage(event, source, 'https://other.example.test'), false);
    for (const origin of ['null', 'http://custom.example.test', 'https://custom.example.test/path',
        'https://custom.example.test/', 'https://user@custom.example.test', 'https://*.example.test',
        'https://custom.example.test.evil.invalid']) {
        assert.equal(isPotentialParentMessage({ source, origin }, source, 'https://custom.example.test'), false);
    }
    assert.equal(isPotentialParentMessage({ source, origin: 'https://*.example.test' }, source, ''), false);
});

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
test('frame readiness invalidates the prior document-loaded state without clearing dirty', () => {
    for (const message of [
        { MessageId: 'App_LoadingStatus', Values: { Status: 'Frame_Ready' } },
    ]) {
        assert.equal(editorReloadStarted(message), true);
        assert.equal(nextDirty(true, message), true);
    }
    assert.equal(editorReloadStarted({ MessageId: 'App_LoadingStatus', Values: { Status: 'Document_Loaded' } }), false);
    assert.equal(editorReloadStarted({ MessageId: 'UI_SaveAs' }), false);
    assert.equal(editorReloadStarted({ MessageId: 'File_Rename' }), false);
});
test('live launch binds exact host context without trusting backend navigation', () => {
    const editor = 'https://code.example', wopi = 'https://wopi.example';
    const context = { workspace: { id: 'workspace' }, file: { nodeId: 'node', branch: 'main' } };
    const source = `${wopi}/wopi/files/${'d'.repeat(32)}`;
    const value = {
        fileId: 'd'.repeat(32), nodeId: 'node', sessionId: 'a'.repeat(32), workspaceId: 'workspace', branch: 'main',
        accessToken: 'c'.repeat(43), accessTokenTtl: Date.now() + 60_000, readOnly: true, format: 'xlsx', name: 'test.xlsx',
        action: `${editor}/browser/abc/cool.html?WOPISrc=${encodeURIComponent(source)}`,
        editorOrigin: editor, wopiSource: source
    };
    assert.equal(validateLiveLaunch(value, editor, wopi, context), value);
    const platformProfile = { ...value, accessTokenTtl: Date.now() + 10 * 3600_000 };
    assert.equal(validateLiveLaunch(platformProfile, editor, wopi, context), platformProfile);
    const continued = { sessionId: 'b'.repeat(32), workspaceId: value.workspaceId, branch: value.branch,
        nodeId: 'parent-selected-target', fileId: 'f'.repeat(32), name: 'copy.xlsx', format: 'xlsx',
        readOnly: false, accessTokenTtl: Date.now() + 2 * 3600_000 };
    assert.deepEqual(validateLiveContinuation(continued, value), continued);
    for (const change of [
        { workspaceId: 'foreign' }, { branch: 'foreign' }, { accessTokenTtl: Date.now() - 1 },
        { accessTokenTtl: NaN }, { fileId: 'wrong-target' }, { nodeId: '' }, { sessionId: '' },
        { accessToken: value.accessToken }, { credentialId: 'parent-only' }, { action: value.action },
        { wopiSource: value.wopiSource }, { format: 'exe' }, { readOnly: undefined },
    ]) assert.throws(() => validateLiveContinuation({ ...continued, ...change }, value));
    for (const [format, definition] of Object.entries(formats)) {
        assert.equal(validateLiveLaunch({ ...value, format }, editor, wopi, context).format, format);
        if (definition.mode === 'view')
            assert.throws(() => validateLiveLaunch({ ...value, format, readOnly: false }, editor, wopi, context));
        else
            assert.equal(validateLiveLaunch({ ...value, format, readOnly: false }, editor, wopi, context).readOnly, false);
    }
    for (const change of [
        { fileId: 'e'.repeat(32) }, { nodeId: 'other' }, { workspaceId: 'other' },
        { accessTokenTtl: Number.MAX_SAFE_INTEGER + 1 }, { accessTokenTtl: Number.NaN },
        { accessToken: 'not-a-credential' }, { readOnly: undefined }, { format: 'exe' }, { format: '__proto__' },
        { wopiSource: source.replace('/files/', '/other/') }, { action: value.action.replace('code.example', 'untrusted.example') },
        { action: value.action + '&WOPISrc=evil' }, { accessTokenTtl: 0 },
        { name: null }, { action: value.action + '&access_token=leaked' },
        { action: value.action.replace('/browser/abc/cool.html', '/elsewhere') }
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
        { receipt: null }, { state: 'conflict' }, { receipt: { ...request, revision: '' } },
        { continuationAvailable: true },
        { receipt: { ...result.receipt, correlation: 'earlier-save' } },
        { receipt: { ...result.receipt, generation: 1 } }
    ]) assert.equal(saveConfirmed({ ...result, ...change }, request, 2, false), false);
});

test('CODE Save As is only a continuation signal and cannot acknowledge the source save', () => {
    const message = { MessageId: 'Action_Save_Resp', Values: { success: true, fileName: 'copy.docx' } };
    assert.equal(isDerivedSaveResponse(message), true);
    assert.equal(nextDirty(false, message), true);
    assert.equal(nextDirty(true, message), true);
    assert.equal(isDerivedSaveResponse({ MessageId: 'Action_Save_Resp', Values: { success: true } }), false);
    assert.equal(isDerivedSaveResponse({ ...message, Values: { success: false, fileName: 'copy.docx' } }), false);
    assert.equal(saveConfirmed({ state: 'ready', revision: 'new-head', receipt: null },
        { generation: 1, correlation: 'source-checkpoint' }, 1, false), false);
});

test('Save As uses the requested editable format and never treats a filename as target authority', () => {
    assert.deepEqual(saveAsDraft('source.docx', 'docx', undefined), { filename: 'source copy.docx', format: 'docx' });
    assert.deepEqual(saveAsDraft('source.docx', 'docx', 'odt'), { filename: 'source copy.odt', format: 'odt' });
    for (const format of ['pdf', 'exe', '__proto__', 'DOCX', null, {}, '../docx'])
        assert.throws(() => saveAsDraft('source.docx', 'docx', format));
    const command = saveAsCommand('A new copy.docx', 'docx');
    assert.equal(command.MessageId, 'Action_SaveAs');
    assert.ok(Number.isSafeInteger(command.SendTime));
    assert.deepEqual(command.Values, { Filename: 'A new copy.docx', Notify: true });
});

test('Save As rejects paths, invalid names and unrequested format changes before sending CODE a command', () => {
    for (const filename of ['', '.docx', '..docx', '../copy.docx', 'folder/copy.docx', 'folder\\copy.docx',
        ' copy.docx', 'copy.docx ', 'copy.odt', 'copy\u0000.docx', 'copy\n.docx', `${'a'.repeat(251)}.docx`])
        assert.throws(() => saveAsCommand(filename, 'docx'));
    assert.throws(() => saveAsCommand('copy.pdf', 'pdf'));
});

test('a later coauthor revision cannot invalidate an exact earlier durable save receipt', () => {
    const request = { correlation: 'own-save', generation: 4 };
    const status = {
        state: 'ready', revision: 'later-coauthor-revision',
        receipt: { ...request, revision: 'own-committed-revision' },
    };
    assert.equal(saveConfirmed(status, request, 4, false), true);
    assert.equal(saveConfirmed({ ...status, receipt: null }, request, 4, false), false);
    assert.equal(saveConfirmed(status, request, 5, false), false);
    assert.equal(saveConfirmed(status, request, 4, true), false);
});

test('revocation and expiry preserve visible recovery instructions and stop the session', () => {
    assert.equal(sessionStatusProblem('ready'), null);
    assert.equal(sessionStatusProblem('revoked').terminal, true);
    assert.match(sessionStatusProblem('revoked').message, /Editing access was revoked.*Preserve unverified edits/);
    assert.equal(sessionStatusProblem('expired').terminal, true);
    assert.match(sessionStatusProblem('expired').message, /session expired/);
    assert.equal(sessionStatusProblem('conflict').terminal, false);
    assert.match(sessionStatusProblem('unknown').message, /recovery.*no overwrite/);
});
