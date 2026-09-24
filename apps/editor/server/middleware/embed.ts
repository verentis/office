import { exactHttpsOrigin } from '../../shared/frame-policy.mjs';

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event);
    if (config.public.syntheticOnly === true || String(config.public.syntheticOnly) === 'true') return;
    const url = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true });
    const navigation = url.pathname === '/' ||
        getHeader(event, 'accept')?.includes('text/html') &&
        !/^\/(?:api|_nuxt|browser)(?:\/|$)/.test(url.pathname);
    if (!navigation) return;
    setHeader(event, 'Content-Security-Policy', "frame-ancestors 'none'");
    if (event.method !== 'GET') throw createError({ statusCode: 405 });
    if (url.origin !== config.public.wrapperOrigin)
        throw createError({ statusCode: 403 });
    const tickets = url.searchParams.getAll('embedTicket');
    if (tickets.length !== 1 || !/^[A-Za-z0-9_-]{32,128}$/.test(tickets[0]!))
        throw createError({ statusCode: 403 });
    const response = await fetch(new URL('/embed/authorize', config.backendUrl), {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket: tickets[0] }), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw createError({ statusCode: 403 });
    const result: unknown = await response.json();
    const parent = typeof result === 'object' && result !== null && 'parentOrigin' in result
        ? result.parentOrigin : null;
    try {
        setHeader(event, 'Content-Security-Policy', `frame-ancestors ${exactHttpsOrigin(parent as string)}`);
    } catch {
        throw createError({ statusCode: 502 });
    }
    setHeader(event, 'Cache-Control', 'no-store');
    setHeader(event, 'Referrer-Policy', 'no-referrer');
});
