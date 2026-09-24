import process from 'node:process';

if (Boolean(process.env.NUXT_HTTPS_CERT) !== Boolean(process.env.NUXT_HTTPS_KEY)) {
    throw new Error('Configure both NUXT_HTTPS_CERT and NUXT_HTTPS_KEY for local HTTPS.');
}

export default defineNuxtConfig({
    compatibilityDate: '2026-02-01',
    devtools: { enabled: false },
    ssr: false,
    nitro: { externals: { inline: [/frame-policy\.mjs$/] } },
    devServer: {
        https: process.env.NUXT_HTTPS_CERT && process.env.NUXT_HTTPS_KEY
            ? { cert: process.env.NUXT_HTTPS_CERT, key: process.env.NUXT_HTTPS_KEY }
            : false
    },
    runtimeConfig: {
        backendUrl: 'http://backend:8080',
        codeUrl: 'http://code:9980',
        public: {
            syntheticOnly: false,
            wrapperOrigin: 'https://office.localtest.me',
            parentOrigin: '',
            parentOrigins: '',
            editorOrigin: 'https://code.localhost:8443',
            wopiOrigin: 'https://wopi.localhost:8443'
        }
    },
    app: {
        head: {
            title: 'Verentis Office',
            meta: [{ name: 'referrer', content: 'no-referrer' }]
        }
    },
    routeRules: {
        '/**': { headers: { 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } }
    }
});
