import assert from 'node:assert/strict';
import test from 'node:test';
import {
    appliedReply, insertions, liveRequest, selectionReply, unavailableReply, MAX_INSERT_CHARS, MAX_OPERATIONS
} from '../../apps/editor/shared/agent-live.mjs';
import { MAX_TEXT_CHARS } from '../../apps/editor/shared/agent-read.mjs';

test('answers only for the open document', () => {
    assert.deepEqual(liveRequest({ action: 'read', path: '/a/Brief.docx' }, '/a/Brief.docx'),
        { action: 'read', path: '/a/Brief.docx', operations: undefined });
    assert.equal(liveRequest({ action: 'read', path: 'a/Brief.docx' }, '/a/Brief.docx').path, '/a/Brief.docx');
    for (const [payload, open] of [
        [{ action: 'read', path: '/a/Other.docx' }, '/a/Brief.docx'],
        [{ action: 'read', path: '/a/brief.docx' }, '/a/Brief.docx'],
        [{ action: 'read', path: '/a/Brief.docx' }, ''],
        [{ action: 'read', path: 7 }, '/a/Brief.docx'],
    ]) assert.equal(liveRequest(payload, open).reply?.code, 'not_open');
    for (const payload of [null, 'read', [], { action: 'delete', path: '/a/Brief.docx' }])
        assert.equal(liveRequest(payload, '/a/Brief.docx').reply?.code, 'invalid_request');
});

test('a selection is returned as content; no selection sends the agent to the headless read', () => {
    const reply = selectionReply('/a/Brief.docx', 'Quarterly summary', true);
    assert.equal(reply.ok, true);
    assert.equal(reply.scope, 'selection');
    assert.equal(reply.content, 'Quarterly summary');
    assert.equal(reply.dirty, true);
    assert.match(reply.note, /unsaved edits/);
    assert.doesNotMatch(selectionReply('/a/Brief.docx', 'x', false).note, /unsaved/);
    for (const empty of [null, undefined, '', '  \n'])
        assert.equal(selectionReply('/a/Brief.docx', empty, false).code, 'use_headless');
    const long = selectionReply('/a/Brief.docx', 'x'.repeat(MAX_TEXT_CHARS + 1), false);
    assert.equal(long.truncated, true);
    assert.equal(long.content.length, MAX_TEXT_CHARS);
});

test('apply accepts only bounded insert_text operations', () => {
    assert.deepEqual(insertions([{ op: 'insert_text', text: 'Hello' }, { op: 'insert_text', text: ' world' }]),
        { texts: ['Hello', ' world'] });
    assert.equal(insertions([]).reply.code, 'invalid_operations');
    assert.equal(insertions(null).reply.code, 'invalid_operations');
    assert.equal(insertions([{ op: 'insert_text', text: '' }]).reply.code, 'invalid_operations');
    assert.equal(insertions([{ op: 'delete_range' }]).reply.code, 'unsupported_operation');
    assert.equal(insertions([{ op: 'insert_text', text: 'x'.repeat(MAX_INSERT_CHARS + 1) }]).reply.code, 'too_large');
    assert.equal(insertions(Array.from({ length: MAX_OPERATIONS + 1 }, () => ({ op: 'insert_text', text: 'x' }))).reply.code,
        'invalid_operations');
});

test('applied and unavailable replies say what happened', () => {
    assert.deepEqual({ ...appliedReply('/a/Brief.docx', 2), note: undefined },
        { ok: true, path: '/a/Brief.docx', applied: 2, saved: false, note: undefined });
    assert.equal(unavailableReply({ readOnly: true, ready: true }).code, 'read_only');
    assert.equal(unavailableReply({ readOnly: false, ready: false }).code, 'not_ready');
});
