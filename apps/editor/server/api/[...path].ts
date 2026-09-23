export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event);
    const path = getRouterParam(event, 'path') ?? '';
    const synthetic = config.public.syntheticOnly === true || String(config.public.syntheticOnly) === 'true';
    if (path !== 'sessions' && !(synthetic && (path === 'test/sessions' || /^test\/files\/[a-f0-9]{32}$/.test(path)))) {
        throw createError({ statusCode: 404 });
    }
    if ((path === 'sessions' || path === 'test/sessions') && event.method !== 'POST') {
        throw createError({ statusCode: 405 });
    }
    if (path.startsWith('test/files/') && event.method !== 'GET') throw createError({ statusCode: 405 });
    const origin = getHeader(event, 'origin');
    const ownOrigin = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin;
    if (event.method === 'POST' && origin !== ownOrigin) throw createError({ statusCode: 403 });
    let body: string | undefined;
    if (path === 'test/sessions') {
        const length = Number(getHeader(event, 'content-length'));
        if (!Number.isSafeInteger(length) || length <= 0) throw createError({ statusCode: 411 });
        if (length > 4096) throw createError({ statusCode: 413 });
        body = await readRawBody(event);
    }
    const response = await fetch(new URL(`/${path}`, config.backendUrl), {
        method: event.method,
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', Origin: ownOrigin, 'X-Test-Identity': 'synthetic-user' },
        body,
        signal: AbortSignal.timeout(20000)
    });
    setResponseStatus(event, response.status);
    setHeader(event, 'Cache-Control', 'no-store');
    const contentType = response.headers.get('content-type');
    if (contentType) setHeader(event, 'Content-Type', contentType);
    return await response.text();
});
