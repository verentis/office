import process from 'node:process';

if (Boolean(process.env.NUXT_HTTPS_CERT) !== Boolean(process.env.NUXT_HTTPS_KEY)) {
    throw new Error('Configure both NUXT_HTTPS_CERT and NUXT_HTTPS_KEY for local HTTPS.');
}

export default defineNuxtConfig({
    compatibilityDate: '2026-02-01',
    devtools: { enabled: false },
    ssr: false,
    nitro: { externals: { inline: [/frame-policy\.mjs$/, /agent-read\.mjs$/] } },
    devServer: {
        https: process.env.NUXT_HTTPS_CERT && process.env.NUXT_HTTPS_KEY
            ? { cert: process.env.NUXT_HTTPS_CERT, key: process.env.NUXT_HTTPS_KEY }
            : false
    },
    runtimeConfig: {
        collaborationUrl: 'http://collaboration:8080',
        codeUrl: 'http://code:9980',
        // Platform API origin for the agent read tool; falls back to public.wopiOrigin (the platform gateway).
        platformApiUrl: '',
        public: {
            wrapperOrigin: 'https://office.localtest.me',
            editorOrigin: 'https://code.localhost:8443',
            wopiOrigin: 'https://api.localtest.me'
        }
    },
    app: {
        head: {
            title: 'Verentis Office',
            meta: [{ name: 'referrer', content: 'strict-origin' }]
        }
    },
    routeRules: {
        '/**': { headers: { 'Referrer-Policy': 'strict-origin', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } }
    }
});
