import {
    CONVERT_TO, MAX_SOURCE_BYTES, failure, rawFileUrl, readableKind, sheetHtmlToText, slidesFodpToText, truncate,
    validWorkspacePath
} from '../../../shared/agent-read.mjs';

/**
 * The read_document agent tool (spec.tools): the platform calls it with a token minted for the calling user and
 * capped to file.read. Office downloads the saved file with that token, converts it with its own CODE server
 * and returns text. Nothing is stored; the token is used once and only against the platform origin.
 */
const NOTES = {
    text: 'Plain text of the document, without formatting. This is the last saved version.',
    sheet: 'Rows are tab-separated; with several sheets each starts with "## <name>". This is the last saved version.',
    slides: 'Each slide starts with "## Slide N"; speaker notes follow "Notes:". This is the last saved version.'
} as const;

export default defineEventHandler(async (event) => {
    setHeader(event, 'Cache-Control', 'no-store');
    const authorization = getHeader(event, 'authorization');
    if (!authorization || !/^Bearer [A-Za-z0-9_.~+/=-]{16,8192}$/.test(authorization))
        throw createError({ statusCode: 401 });

    const body = await readBody<{ path?: unknown; action?: unknown }>(event).catch(() => null);
    if (!body || (body.action !== undefined && body.action !== 'read'))
        return failure('invalid_request', 'read_document only reads; send { path }.');
    const path = body.path;
    if (!validWorkspacePath(path)) return failure('invalid_path', 'Send an absolute workspace path such as /reports/q1.docx.');
    const kind = readableKind(path);
    if (!kind) return failure('unsupported_format', 'Libre Office reads text documents, spreadsheets and presentations; read plain-text files with fs_read.');

    const config = useRuntimeConfig(event);
    const platformUrl = config.platformApiUrl || config.public.wopiOrigin;
    let download: Response;
    try {
        download = await fetch(rawFileUrl(platformUrl, path), {
            redirect: 'error', headers: { Authorization: authorization }, signal: AbortSignal.timeout(30000)
        });
    } catch {
        return failure('platform_unreachable', 'The workspace file could not be downloaded.');
    }
    if (download.status === 404) return failure('not_found', 'No file exists at this path.');
    if (download.status === 401 || download.status === 403)
        return failure('forbidden', 'The user is not permitted to read this file.');
    if (!download.ok) return failure('download_failed', `The workspace file could not be downloaded (${download.status}).`);
    if (Number(download.headers.get('content-length') ?? 0) > MAX_SOURCE_BYTES)
        return failure('too_large', 'The file is larger than Libre Office reads for the agent (50 MB).');
    const bytes = await download.arrayBuffer();
    if (bytes.byteLength > MAX_SOURCE_BYTES)
        return failure('too_large', 'The file is larger than Libre Office reads for the agent (50 MB).');

    const form = new FormData();
    form.append('data', new Blob([bytes]), path.split('/').pop()!);
    let converted: Response;
    try {
        converted = await fetch(new URL(`/cool/convert-to/${CONVERT_TO[kind]}`, config.codeUrl), {
            method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(60000)
        });
    } catch {
        return failure('conversion_unavailable', 'The document converter could not be reached.');
    }
    if (!converted.ok) return failure('conversion_failed', `The document could not be converted (${converted.status}).`);
    const output = await converted.text();
    const text = kind === 'sheet' ? sheetHtmlToText(output)
        : kind === 'slides' ? slidesFodpToText(output)
            : output.replace(/^\uFEFF/, '').trim();
    const { content, truncated } = truncate(text);
    return {
        ok: true,
        path,
        format: { text: 'text', sheet: 'sheet-rows', slides: 'slides' }[kind],
        content,
        truncated,
        note: NOTES[kind]
    };
});
