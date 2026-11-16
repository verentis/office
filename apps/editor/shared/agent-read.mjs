import formats from './formats.json' with { type: 'json' };

// Plain-text formats are left to the platform's own fs_read; converting them would only lose fidelity.
const PLAIN = new Set(['txt', 'md', 'csv', 'tsv']);
export const MAX_SOURCE_BYTES = 52428800;
export const MAX_TEXT_CHARS = 200000;

/**
 * How the agent read tool turns a file into text: 'text' (Writer → txt), 'sheet' (Calc → html → rows),
 * 'slides' (Impress → flat ODP → slide text) or null.
 */
export function readableKind(path) {
    const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
    const format = extension && !PLAIN.has(extension) ? formats[extension] : undefined;
    if (format?.icon === '#doc') return 'text';
    if (format?.icon === '#sheet') return 'sheet';
    if (format?.icon === '#slides') return 'slides';
    return null;
}

/** A workspace path the tool may download: absolute, no traversal or control characters. */
export function validWorkspacePath(path) {
    return typeof path === 'string' && path.length > 1 && path.length <= 1024 && path.startsWith('/') &&
        !/[\u0000-\u001f\u007f\\]/.test(path) && !path.split('/').some(part => part === '.' || part === '..');
}

export function rawFileUrl(platformUrl, path) {
    const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return new URL(`/v1/files/raw/${encoded}?branch=main`, platformUrl);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = text => text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()] ?? match;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
});

/**
 * Calc's HTML export flattened to tab-separated rows. A workbook with several sheets starts with an "Overview"
 * block of links (dropped) and then each sheet as <a name="tableN"><h1>Sheet N: <em>Name</em></h1></a> + a table,
 * which becomes "## Name".
 */
export function sheetHtmlToText(html) {
    let body = html.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '').replace(/>\s+</g, '><');
    const firstSheet = body.search(/<a\s+name="table0"/i);
    if (firstSheet > 0) body = body.slice(firstSheet);
    const text = body
        .replace(/<h1\b[^>]*>/gi, '\n## ')
        .replace(/<\/h1>/gi, '\n')
        .replace(/<\/t[dh]>/gi, '\t')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '');
    return decode(text)
        .split('\n')
        .map(line => line.startsWith('## ')
            ? line.replace(/^## Sheet \d+: /, '## ').trim()
            : line.split('\t').map(cell => cell.trim()).join('\t').replace(/\t+$/, ''))
        .filter((line, index, lines) => line !== '' || (index > 0 && lines[index - 1] !== ''))
        .join('\n')
        .trim();
}

/** The CODE convert-to target for each readable kind. */
export const CONVERT_TO = { text: 'txt', sheet: 'html', slides: 'fodp' };

// ODF collapses raw whitespace (including the export's indentation) to one space; only elements break lines.
const odfText = xml => decode(xml
    .replace(/\s+/g, ' ')
    .replace(/<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/g,
        (_, cell) => `${cell.replace(/<\/text:(?:p|h)>|<text:line-break\b[^>]*\/>/g, ' ')}</table:table-cell>`)
    .replace(/<text:s\b[^>]*?(?:text:c="(\d+)")?[^>]*\/>/g, (_, count) => ' '.repeat(Math.min(Number(count ?? 1), 64)))
    .replace(/<text:tab\b[^>]*\/>/g, '\t')
    .replace(/<text:line-break\b[^>]*\/>/g, '\n')
    .replace(/<\/text:(?:p|h)>/g, '\n')
    .replace(/<\/table:table-cell>/g, '\t')
    .replace(/<\/table:table-row>/g, '\n')
    .replace(/<[^>]+>/g, ''))
    .split('\n')
    .map(line => line.split('\t').map(cell => cell.trim()).join('\t').replace(/\t+$/, ''))
    .filter(line => line.trim() !== '')
    .join('\n');

/**
 * Impress's flat ODP export flattened to "## Slide N" sections, with speaker notes under "Notes:". Master pages,
 * embedded images and page-number/date/header/footer placeholders are dropped.
 */
export function slidesFodpToText(xml) {
    const start = xml.indexOf('<office:presentation');
    const end = xml.indexOf('</office:presentation>');
    if (start < 0 || end < start) return '';
    const body = xml.slice(start, end)
        .replace(/<office:binary-data>[\s\S]*?<\/office:binary-data>/g, '')
        .replace(/<(svg:title|svg:desc)\b[^>]*>[\s\S]*?<\/\1>/g, '')
        .replace(/<draw:frame\b[^>]*presentation:class="(?:page-number|date-time|header|footer)"[^>]*>[\s\S]*?<\/draw:frame>/g, '');
    const slides = [...body.matchAll(/<draw:page\b[^>]*>([\s\S]*?)<\/draw:page>/g)].map((match, index) => {
        const notesMatch = /<presentation:notes\b[^>]*>([\s\S]*?)<\/presentation:notes>/.exec(match[1]);
        const slide = odfText(notesMatch ? match[1].replace(notesMatch[0], '') : match[1]);
        const notes = notesMatch ? odfText(notesMatch[1]) : '';
        return [`## Slide ${index + 1}`, slide, notes && `Notes:\n${notes}`].filter(Boolean).join('\n');
    });
    return slides.join('\n\n');
}

export function truncate(text) {
    return text.length > MAX_TEXT_CHARS
        ? { content: text.slice(0, MAX_TEXT_CHARS), truncated: true }
        : { content: text, truncated: false };
}

export const failure = (code, message) => ({ ok: false, code, message });
