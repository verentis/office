import { Readable } from 'node:stream';
import { bindFrameAncestors } from '../../../shared/frame-policy.mjs';

const versionedAssetPath = /^\/browser\/[a-fA-F0-9]{8,64}\/.+\.(?:avif|bin|bmp|css|eot|gif|ico|jpe?g|js|json|map|mjs|png|svg|wasm|webp|woff2?|ttf|otf)$/i;
const staticContentTypes = [
    'application/font-woff', 'application/javascript', 'application/json', 'application/octet-stream',
    'application/vnd.ms-fontobject', 'application/wasm', 'application/x-font-ttf', 'application/x-font-woff',
    'font/', 'image/', 'text/css', 'text/javascript'
];

function isCacheableAsset(method: string, hasRequestCredentials: boolean, incoming: URL, response: Response,
    contentType: string, cookies: string[]) {
    const mediaType = contentType.split(';', 1)[0]!.trim().toLowerCase();
    const upstreamCacheControl = response.headers.get('cache-control') ?? '';
    const vary = (response.headers.get('vary') ?? '').split(',').map(value => value.trim().toLowerCase());
    return method === 'GET'
        && response.status === 200
        && versionedAssetPath.test(incoming.pathname)
        && incoming.search === ''
        && !hasRequestCredentials
        && cookies.length === 0
        && !/\b(?:private|no-cache|no-store)\b/i.test(upstreamCacheControl)
        && !vary.some(value => value === '*' || value === 'cookie' || value === 'authorization')
        && staticContentTypes.some(type => type.endsWith('/') ? mediaType.startsWith(type) : mediaType === type);
}

export default defineEventHandler(async (event) => {
    if (event.method !== 'GET' && event.method !== 'POST') throw createError({ statusCode: 405 });
    const config = useRuntimeConfig(event);
    const incoming = getRequestURL(event);
    if (!/^\/browser\/[a-zA-Z0-9._/-]+$/.test(incoming.pathname))
        throw createError({ statusCode: 404 });
    if (incoming.search.length > 2048) throw createError({ statusCode: 414 });
    const documentPage = /^\/browser\/[^/]+\/cool\.html$/.test(incoming.pathname);
    if (documentPage && event.method !== 'POST') throw createError({ statusCode: 403 });
    if (documentPage && getHeader(event, 'origin') !== config.public.wrapperOrigin)
        throw createError({ statusCode: 403 });
    if (!documentPage && event.method !== 'GET') throw createError({ statusCode: 405 });

    let body: string | undefined;
    let parentOrigin: string | undefined;
    if (documentPage) {
        const length = Number(getHeader(event, 'content-length'));
        if (!Number.isSafeInteger(length) || length < 1 || length > 16384)
            throw createError({ statusCode: 413 });
        if (getHeader(event, 'content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded')
            throw createError({ statusCode: 415 });
        body = await readRawBody(event);
        if (!body || Buffer.byteLength(body) > 16384) throw createError({ statusCode: 413 });
        const fields = new URLSearchParams(body);
        const credentials = fields.getAll('access_token');
        const sources = incoming.searchParams.getAll('WOPISrc');
        if (credentials.length !== 1 || !/^[A-Za-z0-9_.-]{43,8192}$/.test(credentials[0]!) || sources.length !== 1)
            throw createError({ statusCode: 403 });
        let source: URL;
        try { source = new URL(sources[0]!); }
        catch { throw createError({ statusCode: 403 }); }
        if (source.origin !== config.public.wopiOrigin || source.search || source.hash || source.username || source.password)
            throw createError({ statusCode: 403 });
        if (!/^\/wopi\/files\/[a-f0-9]{32}$/.test(source.pathname)) throw createError({ statusCode: 403 });
        const authorization = await fetch(new URL('/v1/collaboration/frames/authorize', config.collaborationUrl), {
            method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: credentials[0], wopiSource: source.href }),
            signal: AbortSignal.timeout(15000)
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
    const cookies = response.headers.getSetCookie();
    if (contentType) setHeader(event, 'Content-Type', contentType);
    const cacheable = isCacheableAsset(event.method,
        Boolean(getHeader(event, 'cookie') || getHeader(event, 'authorization')),
        incoming, response, contentType, cookies);
    setHeader(event, 'Cache-Control', cacheable ? 'public, max-age=31536000, immutable' : 'no-store');
    setHeader(event, 'X-Content-Type-Options', 'nosniff');
    for (const cookie of cookies) appendHeader(event, 'Set-Cookie', cookie);
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
