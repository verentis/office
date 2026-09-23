import process from 'node:process';

if (Boolean(process.env.NUXT_HTTPS_CERT) !== Boolean(process.env.NUXT_HTTPS_KEY)) {
    throw new Error('Configure both NUXT_HTTPS_CERT and NUXT_HTTPS_KEY for local HTTPS.');
}

export default defineNuxtConfig({
    compatibilityDate: '2026-02-01',
    devtools: { enabled: false },
    ssr: false,
    devServer: {
        https: process.env.NUXT_HTTPS_CERT && process.env.NUXT_HTTPS_KEY
            ? { cert: process.env.NUXT_HTTPS_CERT, key: process.env.NUXT_HTTPS_KEY }
            : false
    },
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
