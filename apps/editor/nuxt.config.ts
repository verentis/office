export default defineNuxtConfig({
    compatibilityDate: '2026-02-01',
    devtools: { enabled: false },
    ssr: false,
    runtimeConfig: {
        backendUrl: 'http://backend:8080',
        public: {
            syntheticOnly: false,
            parentOrigin: '',
            editorOrigin: 'https://code.localhost:8443',
            wopiOrigin: 'https://wopi.localhost:8443'
        }
    },
    app: {
        head: {
            title: 'Office — live integration disabled',
            meta: [{ name: 'referrer', content: 'no-referrer' }]
        }
    },
    routeRules: {
        '/**': { headers: { 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } }
    }
});
