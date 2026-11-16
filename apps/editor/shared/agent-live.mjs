import { truncate } from './agent-read.mjs';

/** The `spec.messages` channel the platform uses to act in the open document (`spec.actor.live-channel`). */
export const LIVE_CHANNEL = 'agent';
/** Upper bound on text one apply may insert; the platform caps a live apply at 15 KB as well. */
export const MAX_INSERT_CHARS = 15000;
export const MAX_OPERATIONS = 100;
export const SELECTION_TIMEOUT_MS = 3000;

const reply = (code, message) => ({ ok: false, code, message });
const normalise = path => (typeof path === 'string' ? `/${path.replace(/^\/+/, '')}` : '');

/**
 * Checks a host message on the live channel against the document this editor has open. Returns
 * `{ action, path, operations }` or `{ reply }` with the answer to send back as is.
 */
export function liveRequest(payload, openPath) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        return { reply: reply('invalid_request', 'Expected { action, path }.') };
    const { action, path, operations } = payload;
    if (action !== 'read' && action !== 'apply')
        return { reply: reply('invalid_request', "action must be 'read' or 'apply'.") };
    if (typeof path !== 'string' || !openPath || normalise(path) !== normalise(openPath))
        return { reply: reply('not_open', 'Office has a different document open.') };
    return { action, path: normalise(openPath), operations };
}

/**
 * The text an apply inserts, one entry per operation, in order. Each operation is
 * `{ op: 'insert_text', text }`: CODE pastes it at the cursor, replacing the user's selection.
 */
export function insertions(operations) {
    if (!Array.isArray(operations) || operations.length === 0)
        return { reply: reply('invalid_operations', "operations must be a non-empty array of { op: 'insert_text', text }.") };
    if (operations.length > MAX_OPERATIONS)
        return { reply: reply('invalid_operations', `At most ${MAX_OPERATIONS} operations per apply.`) };
    const texts = [];
    let total = 0;
    for (const [index, operation] of operations.entries()) {
        if (operation?.op !== 'insert_text')
            return { reply: reply('unsupported_operation', `Operation ${index}: only 'insert_text' is supported in the open document.`) };
        if (typeof operation.text !== 'string' || operation.text.length === 0)
            return { reply: reply('invalid_operations', `Operation ${index}: text must be a non-empty string.`) };
        total += operation.text.length;
        if (total > MAX_INSERT_CHARS)
            return { reply: reply('too_large', `Insert at most ${MAX_INSERT_CHARS} characters per apply.`) };
        texts.push(operation.text);
    }
    return { texts };
}

/**
 * The live read answer. A selection is returned as the content; with nothing selected the agent is sent to the
 * headless read tool, which reads the whole document as last saved.
 */
export function selectionReply(path, selection, dirty) {
    if (typeof selection !== 'string' || selection.trim() === '')
        return reply('use_headless', 'Nothing is selected in the open document; read the saved file instead.');
    const { content, truncated } = truncate(selection);
    return {
        ok: true,
        path,
        scope: 'selection',
        content,
        truncated,
        dirty: dirty === true,
        note: "This is only the text the user has selected in the open document. For the whole document call app_read with mode 'headless'"
            + (dirty === true ? '; it reflects the last save, and the open document has unsaved edits.' : '.'),
    };
}

export function appliedReply(path, count) {
    return {
        ok: true,
        path,
        applied: count,
        saved: false,
        note: 'Inserted at the cursor in the open document (replacing any selection). The change is unsaved; the user reviews and saves it.',
    };
}

export function unavailableReply(state) {
    if (state.readOnly) return reply('read_only', 'The open document is read-only.');
    if (!state.ready) return reply('not_ready', 'Office is still loading or reloading the document; try again shortly.');
    return reply('not_ready', 'Office cannot edit right now (authorization is being renewed or a save is in progress); try again shortly.');
}
