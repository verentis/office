export function exactHttpsOrigin(value) {
    if (typeof value !== 'string' || value.length > 256) throw new Error('Invalid framing origin.');
    const origin = new URL(value);
    if (origin.protocol !== 'https:' || origin.origin !== value || origin.href !== `${value}/` ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(origin.hostname))
        throw new Error('Invalid framing origin.');
    return value;
}

export function bindFrameAncestors(policy, parentOrigin, wrapperOrigin) {
    const parent = exactHttpsOrigin(parentOrigin);
    const wrapper = exactHttpsOrigin(wrapperOrigin);
    if (typeof policy !== 'string' || !policy || policy.includes(','))
        throw new Error('CODE did not provide an unambiguous framing policy.');
    let count = 0;
    const directives = policy.split(';').map(directive => {
        if (!/^frame-ancestors(?:\s|$)/.test(directive.trim())) return directive;
        count++;
        return `frame-ancestors ${wrapper} ${parent}`;
    });
    if (count !== 1) throw new Error('CODE framing policy must have exactly one ancestor directive.');
    return directives.join(';');
}
