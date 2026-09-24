export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event);
    const path = getRouterParam(event, 'path') ?? '';
    const synthetic = config.public.syntheticOnly === true || String(config.public.syntheticOnly) === 'true';
    const liveStatus = /^sessions\/[a-f0-9]{32}\/status$/.test(path);
    const liveSave = /^sessions\/[a-f0-9]{32}\/saves$/.test(path);
    const liveClose = /^sessions\/[a-f0-9]{32}$/.test(path);
    if (path !== 'sessions' && !liveStatus && !liveClose && !liveSave &&
        !(synthetic && (path === 'test/sessions' || /^test\/files\/[a-f0-9]{32}$/.test(path)))) {
        throw createError({ statusCode: 404 });
    }
    if ((path === 'sessions' || path === 'test/sessions') && event.method !== 'POST') {
        throw createError({ statusCode: 405 });
    }
    if (path.startsWith('test/files/') && event.method !== 'GET') throw createError({ statusCode: 405 });
    if (liveStatus && event.method !== 'GET' || liveClose && event.method !== 'DELETE')
        throw createError({ statusCode: 405 });
    if (liveSave && event.method !== 'POST') throw createError({ statusCode: 405 });
    const origin = getHeader(event, 'origin');
    const ownOrigin = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin;
    if (event.method !== 'GET' && origin !== ownOrigin) throw createError({ statusCode: 403 });
    let body: string | undefined;
    if (path === 'test/sessions' || path === 'sessions' || liveSave) {
        const length = Number(getHeader(event, 'content-length'));
        if (!Number.isSafeInteger(length) || length <= 0) throw createError({ statusCode: 411 });
        if (length > 16384) throw createError({ statusCode: 413 });
        body = await readRawBody(event);
        if (body && Buffer.byteLength(body) > 16384) throw createError({ statusCode: 413 });
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: ownOrigin };
    if (path.startsWith('test/')) headers['X-Test-Identity'] = 'synthetic-user';
    if (liveStatus || liveClose || liveSave) {
        const credential = getHeader(event, 'authorization') ?? '';
        if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(credential)) throw createError({ statusCode: 401 });
        headers.Authorization = credential;
    }
    let response: Response;
    try {
        response = await fetch(new URL(`/${path}`, config.backendUrl), {
            method: event.method, redirect: 'error', headers, body, signal: AbortSignal.timeout(35000)
        });
    } catch {
        throw createError({ statusCode: 503, statusMessage: 'Office backend unavailable. Preserve unverified edits.' });
    }
    setResponseStatus(event, response.status);
    setHeader(event, 'Cache-Control', 'no-store');
    const contentType = response.headers.get('content-type');
    if (contentType) setHeader(event, 'Content-Type', contentType);
    return await response.text();
});
