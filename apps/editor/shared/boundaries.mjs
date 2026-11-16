import { exactHttpsOrigin } from './frame-policy.mjs';
import { isTrustedMessage, validateCollaborationDocument, isDurableSaveConfirmed } from '@verentis/sdk';
export { isTrustedMessage };

export function parseParentOrigins(configuredOrigins) {
    const origins = configuredOrigins.split(',').filter(Boolean).map(value => {
        const origin = new URL(value);
        if (origin.protocol !== 'https:' || origin.href !== `${origin.origin}/` || value.includes('*'))
            throw new Error('Trusted parent origins must be exact HTTPS origins.');
        return origin.origin;
    });
    if (!origins.length) throw new Error('No trusted workspace origins are configured.');
    return origins;
}

export function isTrustedParentMessage(event, source, origins, pinnedOrigin) {
    return origins.includes(event.origin) && isTrustedMessage(event, source, pinnedOrigin || event.origin);
}

export function isPotentialParentMessage(event, source, pinnedOrigin) {
    if (!source || event.source !== source || pinnedOrigin && event.origin !== pinnedOrigin) return false;
    try {
        return exactHttpsOrigin(event.origin) === event.origin;
    } catch {
        return false;
    }
}

export function childMessage(event, source, origin) {
    if (!isTrustedMessage(event, source, origin)) return null;
    try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!data || typeof data !== 'object' || typeof data.MessageId !== 'string') return null;
        return data;
    } catch {
        return null;
    }
}

export function nextDirty(current, message) {
    // CODE's save/modified messages are not an authoritative durable-store acknowledgement.
    return current || isDerivedSaveResponse(message) ||
        (message.MessageId === 'Doc_ModifiedStatus' && message.Values?.Modified === true);
}

export function isDerivedSaveResponse(message) {
    return message.MessageId === 'Action_Save_Resp' && message.Values?.success === true &&
        typeof message.Values.fileName === 'string' && message.Values.fileName.length > 0;
}

export function editorReloadStarted(message) {
    return message.MessageId === 'App_LoadingStatus' && message.Values?.Status === 'Frame_Ready';
}

export function saveAsDraft(name, currentFormat, requestedFormat) {
    const format = requestedFormat === undefined ? currentFormat : requestedFormat;
    if (typeof format !== 'string' || !Object.hasOwn(formats, format) || formats[format].mode !== 'edit')
        throw new Error('Choose a supported editable document format for Save As.');
    const stem = name.replace(/\.[^.]+$/, '');
    return { filename: `${stem} copy.${format}`, format };
}

export function saveAsCommand(filename, format) {
    saveAsDraft('', format, undefined);
    if (typeof filename !== 'string' || filename !== filename.trim() || filename.length > 255 ||
        /[/\\\u0000-\u001f\u007f]/u.test(filename) || !filename.endsWith(`.${format}`) ||
        filename.length <= format.length + 1 || /^[. ]+$/u.test(filename.slice(0, -format.length - 1)))
        throw new Error(`Enter a file name ending in .${format}, without folders or surrounding whitespace (maximum 255 characters).`);
    return { MessageId: 'Action_SaveAs', SendTime: Date.now(), Values: { Filename: filename, Notify: true } };
}

export function sessionStatusProblem(state) {
    if (state === 'ready') return null;
    if (state === 'revoked') return {
        terminal: true,
        message: 'Editing access was revoked. Preserve unverified edits; reopen only after renewed approval.'
    };
    if (state === 'expired') return {
        terminal: true,
        message: 'The editing session expired. Preserve unverified edits and reopen through the workspace.'
    };
    return {
        terminal: false,
        message: 'Another revision or unresolved save requires recovery. Preserve edits; no overwrite was forced.'
    };
}

function validateDocument(value, context) {
    const document = validateCollaborationDocument(value, context ?? {});
    if (!Object.hasOwn(formats, value.format) ||
        (formats[value.format]?.mode === 'view' && !value.readOnly))
        throw new Error('Invalid live launch.');
    return { ...document, format: value.format };
}

export function validateLiveLaunch(value, editorOrigin, wopiOrigin, context) {
    validateDocument(value, context);
    if (typeof value.accessToken !== 'string' || !/^[A-Za-z0-9_.-]{43,8192}$/.test(value.accessToken))
        throw new Error('Invalid live launch.');
    const action = new URL(value.action);
    const source = new URL(value.wopiSource);
    if (action.protocol !== 'https:' || action.origin !== editorOrigin || value.editorOrigin !== editorOrigin ||
        action.username || action.password || action.hash || !/^\/browser\/[^/]+\/cool\.html$/.test(action.pathname) ||
        source.protocol !== 'https:' || source.origin !== wopiOrigin ||
        source.pathname !== `/wopi/files/${value.fileId}` ||
        source.search || source.hash || source.username || source.password ||
        action.searchParams.has('access_token') || action.searchParams.has('access_token_ttl') ||
        action.searchParams.getAll('WOPISrc').length !== 1 ||
        action.searchParams.get('WOPISrc') !== source.href)
        throw new Error('Untrusted live launch destination.');
    return value;
}

export function saveConfirmed(result, request, currentGeneration, editorModified) {
    return isDurableSaveConfirmed(result, request, currentGeneration, editorModified);
}

export function validateLiveContinuation(value, current) {
    if (!value || typeof value !== 'object' || typeof value.nodeId !== 'string' || !value.nodeId ||
        ['accessToken', 'access_token', 'token', 'credentialId', 'embedTicket', 'action', 'editorOrigin', 'wopiSource']
            .some(key => key in value))
        throw new Error('Invalid continuation target.');
    // Only the authenticated parent's response may select the new node, never CODE's filename message.
    return validateDocument(value, {
        workspace: { id: current.workspaceId },
        file: { nodeId: value.nodeId, branch: current.branch }
    });
}
import formats from './formats.json' with { type: 'json' };
