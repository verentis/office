import { Readable } from 'node:stream';
import { bindFrameAncestors } from '../../../shared/frame-policy.mjs';

export default defineEventHandler(async (event) => {
    if (event.method !== 'GET' && event.method !== 'POST') throw createError({ statusCode: 405 });
    const config = useRuntimeConfig(event);
    if (config.public.syntheticOnly === true || String(config.public.syntheticOnly) === 'true')
        throw createError({ statusCode: 404 });
    const incoming = getRequestURL(event);
    if (!/^\/browser\/[a-zA-Z0-9._/-]+$/.test(incoming.pathname))
        throw createError({ statusCode: 404 });
    if (incoming.search.length > 2048) throw createError({ statusCode: 414 });
    const documentPage = /^\/browser\/[^/]+\/cool\.html$/.test(incoming.pathname);
    if (documentPage && event.method !== 'POST') throw createError({ statusCode: 403 });
    if (!documentPage && event.method !== 'GET') throw createError({ statusCode: 405 });

    let body: string | undefined;
    let parentOrigin: string | undefined;
    if (documentPage) {
        const length = Number(getHeader(event, 'content-length'));
        if (!Number.isSafeInteger(length) || length < 1 || length > 2048)
            throw createError({ statusCode: 413 });
        if (getHeader(event, 'content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded')
            throw createError({ statusCode: 415 });
        body = await readRawBody(event);
        if (!body || Buffer.byteLength(body) > 2048) throw createError({ statusCode: 413 });
        const fields = new URLSearchParams(body);
        const credentials = fields.getAll('access_token');
        const sources = incoming.searchParams.getAll('WOPISrc');
        if (credentials.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(credentials[0]!) || sources.length !== 1)
            throw createError({ statusCode: 403 });
        let source: URL;
        try { source = new URL(sources[0]!); }
        catch { throw createError({ statusCode: 403 }); }
        if (source.origin !== config.public.wopiOrigin || source.search || source.hash)
            throw createError({ statusCode: 403 });
        const match = /^\/wopi\/([0-9a-f-]{36})\/([0-9A-F]+)\/files\/([0-9a-f-]{36})$/.exec(source.pathname);
        if (!match) throw createError({ statusCode: 403 });
        const authorization = await fetch(new URL('/frame-authorize', config.backendUrl), {
            method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: credentials[0], scope: {
                workspace: match[1], branch: match[2], file: match[3]
            } }), signal: AbortSignal.timeout(15000)
        });
        if (!authorization.ok) throw createError({ statusCode: 403 });
        const result: unknown = await authorization.json();
        const origin = typeof result === 'object' && result !== null && 'parentOrigin' in result
            ? result.parentOrigin : null;
        if (typeof origin !== 'string')
            throw createError({ statusCode: 502 });
        parentOrigin = origin;
    }

    const target = new URL(incoming.pathname + incoming.search, config.codeUrl);
    const response = await fetch(target, {
        method: event.method, redirect: 'manual', body,
        headers: {
            ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
            ...(getHeader(event, 'cookie') ? { Cookie: getHeader(event, 'cookie')! } : {}),
            'X-Forwarded-Proto': 'https',
            'X-Forwarded-Host': new URL(config.public.editorOrigin).host
        },
        signal: AbortSignal.timeout(30000)
    });
    if (response.status < 200 || response.status >= 300 || !response.body)
        throw createError({ statusCode: 502, statusMessage: 'CODE response unavailable.' });
    setResponseStatus(event, response.status);
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType) setHeader(event, 'Content-Type', contentType);
    setHeader(event, 'Cache-Control', 'no-store');
    setHeader(event, 'X-Content-Type-Options', 'nosniff');
    for (const cookie of response.headers.getSetCookie()) appendHeader(event, 'Set-Cookie', cookie);
    if (documentPage) {
        if (!contentType.startsWith('text/html') || response.headers.has('x-frame-options'))
            throw createError({ statusCode: 502 });
        const policy = response.headers.get('content-security-policy');
        try {
            setHeader(event, 'Content-Security-Policy',
                bindFrameAncestors(policy, parentOrigin!, config.public.wrapperOrigin));
        } catch {
            throw createError({ statusCode: 502, statusMessage: 'CODE framing policy unavailable.' });
        }
    }
    return sendStream(event, Readable.fromWeb(response.body as import('node:stream/web').ReadableStream));
});
