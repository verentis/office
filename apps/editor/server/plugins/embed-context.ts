import { exactHttpsOrigin } from '../../shared/frame-policy.mjs';

export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook('render:html', (html, { event }) => {
        if (!event.context.officeParentOrigin) return;
        const origin = exactHttpsOrigin(event.context.officeParentOrigin);
        html.head.push(`<meta name="verentis-parent-origin" content="${origin}">`);
    });
});
