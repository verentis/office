export function isTrustedMessage(event, source, origin) {
    return Boolean(source && origin && event.source === source && event.origin === origin);
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
