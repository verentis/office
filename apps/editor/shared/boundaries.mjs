export function isTrustedMessage(event, source, origin) {
    return Boolean(source && origin && event.source === source && event.origin === origin);
}

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

export function validateLaunch(value, editorOrigin, wopiOrigin) {
    if (!value || value.syntheticOnly !== true || !/^[A-Za-z0-9_-]{43}$/.test(value.accessToken)
        || !Number.isSafeInteger(value.accessTokenTtl) || value.accessTokenTtl <= Date.now()
        || value.accessTokenTtl > Date.now() + 3_600_000
        || !/^[a-f0-9]{32}$/.test(value.fileId)
        || !['docx', 'odt', 'xlsx', 'ods', 'pptx', 'odp'].includes(value.format)) throw new Error('Invalid synthetic launch.');
    const action = new URL(value.action);
    const source = new URL(value.wopiSource);
    if (action.protocol !== 'https:' || action.origin !== editorOrigin || value.editorOrigin !== editorOrigin
        || action.username || action.password || action.hash
        || !/^\/browser\/[^/]+\/cool\.html$/.test(action.pathname)
        || source.protocol !== 'https:' || source.origin !== wopiOrigin
        || source.pathname !== `/wopi/synthetic/main/files/${value.fileId}`
        || source.search || source.hash || source.username || source.password
        || action.searchParams.getAll('WOPISrc').length !== 1
        || action.searchParams.get('WOPISrc') !== source.href) throw new Error('Untrusted launch destination.');
    return value;
}

export function nextDirty(current, message) {
    // CODE's save/modified messages are not an authoritative durable-store acknowledgement.
    return current || (message.MessageId === 'Doc_ModifiedStatus' && message.Values?.Modified === true);
}

export function validateLiveLaunch(value, editorOrigin, wopiOrigin, context) {
    const branch = context?.file?.branch;
    const node = context?.file?.nodeId;
    const workspace = context?.workspace?.id;
    if (!branch || !node || !workspace || !value || value.syntheticOnly !== false ||
        value.fileId !== node || !/^[a-f0-9]{32}$/.test(value.sessionId) ||
        !/^[A-Za-z0-9_-]{43}$/.test(value.statusCredential) ||
        !/^[A-Za-z0-9_-]{43}$/.test(value.accessToken) ||
        !Number.isSafeInteger(value.accessTokenTtl) || value.accessTokenTtl <= Date.now() ||
        value.accessTokenTtl > Date.now() + 8 * 3600_000 ||
        typeof value.readOnly !== 'boolean' ||
        !Object.hasOwn(formats, value.format) ||
        (formats[value.format]?.mode === 'view' && !value.readOnly))
        throw new Error('Invalid live launch.');
    const action = new URL(value.action);
    const source = new URL(value.wopiSource);
    const branchKey = [...new TextEncoder().encode(branch.trim().toLowerCase())]
        .map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
    if (action.protocol !== 'https:' || action.origin !== editorOrigin || value.editorOrigin !== editorOrigin ||
        action.username || action.password || action.hash || !/^\/browser\/[^/]+\/cool\.html$/.test(action.pathname) ||
        source.protocol !== 'https:' || source.origin !== wopiOrigin ||
        source.pathname !== `/wopi/${workspace}/${branchKey}/files/${node}` ||
        source.search || source.hash || source.username || source.password ||
        action.searchParams.getAll('WOPISrc').length !== 1 ||
        action.searchParams.get('WOPISrc') !== source.href)
        throw new Error('Untrusted live launch destination.');
    return value;
}

export function saveConfirmed(result, request, currentGeneration, editorModified) {
    return Boolean(request && editorModified === false && result?.state === 'ready' &&
        Number.isSafeInteger(currentGeneration) && currentGeneration === request.generation &&
        result.receipt?.generation === request.generation &&
        result.receipt?.correlation === request.correlation &&
        typeof result.receipt?.revision === 'string' && result.receipt.revision.length > 0 &&
        result.receipt.revision === result.revision);
}
import formats from './formats.json' with { type: 'json' };
