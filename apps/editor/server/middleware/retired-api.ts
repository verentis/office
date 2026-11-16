export default defineEventHandler((event) => {
    if (!/^\/api(?:\/|$)/.test(getRequestURL(event).pathname)) return;
    // Avoid Nuxt's HTML error navigation, which correctly requires an embed ticket.
    setResponseStatus(event, 404);
    setHeader(event, 'Content-Type', 'text/plain; charset=utf-8');
    return 'Not Found';
});
