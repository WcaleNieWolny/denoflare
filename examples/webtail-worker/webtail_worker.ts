import { Bytes, IncomingRequestCf, ModuleWorkerContext, encodeXml, importText } from './deps_worker.ts';
import { FAVICON_SVG, FAVICON_ICO_B64, FAVICON_VERSION } from './favicons.ts';
import { TWITTER_IMAGE_VERSION, TWITTER_IMAGE_PNG_B64 } from './twitter.ts';
import { Material } from './material.ts';
import { AppManifest } from './app_manifest.d.ts';
const webtailAppJs = await importText(import.meta.url, './static/webtail_app.js');
// works in deno 1.32.3, prevents import in worker isolate in 1.32.4+,
// Filed https://github.com/denoland/deno/issues/19903 supposedly fixed in 1.35.3, but doesn't help this exact case
// const webtailAppJsSha1 = (await Bytes.ofUtf8(webtailAppJs).sha1()).hex(); 
let webtailAppJsSha1 = '';

export default {

    async fetch(request: IncomingRequestCf, env: WorkerEnv, _ctx: ModuleWorkerContext): Promise<Response> {
        const url = new URL(request.url);

        if (webtailAppJsSha1 === '') webtailAppJsSha1 = (await Bytes.ofUtf8(webtailAppJs).sha1()).hex();

        const redirectResponse = env.redirectHosts ? computeRedirectResponse(url, env.redirectHosts) : undefined;
        if (redirectResponse) return redirectResponse;

        if (url.pathname === '/') {
            const { version, flags, twitter } = env;
            const headers = computeHeaders('text/html; charset=utf-8');
            return new Response(computeHtml(url, { version, flags, twitter }), { headers });
        } else if (url.pathname === computeAppJsPath()) {
            return computeAppResponse();
        } else if (url.pathname.startsWith('/fetch/')) {
            const fetchUrlStr = 'https://' + url.pathname.substring('/fetch/'.length);
            const fetchUrl = new URL(fetchUrlStr);
            const { method } = request;
            if (isFetchAllowed(method, fetchUrl)) {
                const headers = [...request.headers].filter(v => v[0] === 'authorization' || v[0] === 'content-type');
                const body = method === 'POST' ? await request.text() : undefined;
                const request2 = new Request(fetchUrlStr, { method, headers, body });
                return await fetch(request2);
            }
            throw new Response(`Unable to fetch ${fetchUrl}`, { status: 400 });
        } else if (url.pathname === FAVICON_SVG_PATHNAME) {
            const headers = computeHeaders(SVG_MIME_TYPE, { immutable: true });
            return new Response(FAVICON_SVG, { headers });
        } else if (url.pathname === '/favicon.ico' || url.pathname === FAVICON_ICO_PATHNAME) {
            const headers = computeHeaders('image/x-icon', { immutable: url.pathname.includes(`${FAVICON_VERSION}.`) });
            return new Response(Bytes.ofBase64(FAVICON_ICO_B64).array(), { headers });
        } else if (url.pathname === MANIFEST_PATHNAME) {
            const headers = computeHeaders('application/manifest+json', { immutable: true });
            return new Response(JSON.stringify(computeManifest(), undefined, 2), { headers });
        } else if (url.pathname === TWITTER_IMAGE_PNG_PATHNAME) {
            const headers = computeHeaders('image/png', { immutable: true });
            return new Response(Bytes.ofBase64(TWITTER_IMAGE_PNG_B64).array(), { headers });
        } else if (url.pathname === '/robots.txt') {
            const headers = computeHeaders('text/plain; charset=utf-8');
            return new Response('User-agent: *\nDisallow:\n', { headers });
        }
        
        const headers = computeHeaders('text/html; charset=utf-8');
        return new Response(NOT_FOUND, { status: 404, headers });
    }

};

export interface WorkerEnv {
    readonly version?: string;
    readonly flags?: string;
    readonly twitter?: string;
    readonly redirectHosts?: string;
}

//

const MANIFEST_VERSION = '1';
const FAVICON_SVG_PATHNAME = `/favicon.${FAVICON_VERSION}.svg`;
const FAVICON_ICO_PATHNAME = `/favicon.${FAVICON_VERSION}.ico`;
const MANIFEST_PATHNAME = `/app.${MANIFEST_VERSION}.webmanifest`;
const TWITTER_IMAGE_PNG_PATHNAME = `/og-image.${TWITTER_IMAGE_VERSION}.png`;
const SVG_MIME_TYPE = 'image/svg+xml';

let _redirectHosts: Map<string, string> | undefined;

function computeRedirectResponse(url: URL, redirectHosts: string): Response | undefined {
    if (!_redirectHosts) {
        _redirectHosts = new Map<string, string>();
        for (const nvp of redirectHosts.split(',').map(v => v.trim())) {
            const tokens = nvp.split(':').map(v => v.trim());
            if (tokens.length === 2 && tokens[0].length > 0 && tokens[1].length > 0) {
                _redirectHosts.set(tokens[0], tokens[1]);
            }
        }
    }
    const redirectHost = _redirectHosts.get(url.host);
    if (redirectHost) {
        const location = url.toString().replace(url.host, redirectHost);
        return new Response('', { status: 308, headers: { 'Location' : location } });
    }
}

function computeManifest(): AppManifest {
    const name = 'Webtail';
    return {
        'short_name': name,
        name: `${name} for Cloudflare Workers`,
        description: 'View live requests and logs from Cloudflare Workers from the comfort of your browser.',
        icons: [
            { 
                src: FAVICON_SVG_PATHNAME,
                type: SVG_MIME_TYPE,
            },
        ],
        'theme_color': Material.primaryColor900Hex,
        'background_color': Material.backgroundColorHex,
        display: 'standalone',
        start_url: '/',
        lang: 'en-US',
        dir: 'ltr',
    };
}

function computeHeaders(contentType: string, opts: { immutable?: boolean } = {}) {
    const { immutable } = opts;
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    if (immutable) headers.set('Cache-Control', 'public, max-age=604800, immutable');
    return headers;
}

function isFetchAllowed(method: string, url: URL): boolean {
    if (method === 'POST' && url.origin === 'https://api.cloudflare.com' && url.pathname === '/client/v4/graphql') return true;
    return /^(GET|POST)$/.test(method)
        && url.origin === 'https://api.cloudflare.com'
        && url.pathname.startsWith('/client/v4/accounts/') 
        && (url.pathname.includes('/workers/scripts') || (url.pathname.includes('/workers/durable_objects')));
}

function computeAppJsPath(): string {
    return `/app.${webtailAppJsSha1}.js`;
}

function computeAppResponse(): Response {
    return new Response(webtailAppJs, { headers: computeHeaders('text/javascript; charset=utf-8', { immutable: true }) });
}

const ICONS_MANIFEST_AND_THEME_COLORS = `
<link rel="icon" href="${FAVICON_ICO_PATHNAME}">
<link rel="icon" href="${FAVICON_SVG_PATHNAME}" type="${SVG_MIME_TYPE}">
<link rel="mask-icon" href="${FAVICON_SVG_PATHNAME}" color="${Material.primaryColor200Hex}">
<link rel="manifest" href="${MANIFEST_PATHNAME}">
<meta name="theme-color" content="${Material.primaryColor900Hex}" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="${Material.primaryColor900Hex}">
`;

const COMMON_STYLES = `
body {
    font-family: ${Material.sansSerifFontFamily};
    background-color: ${Material.backgroundColorHex};
    color: red; /* to catch non-explicit text colors */
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

#centered {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;

    /* body2 */
    font-size: 0.875rem;
    letter-spacing: 0.01786rem;
    font-weight: normal;
    line-height: 1.25rem;

    /* medium-emphasis text */
    color: rgba(255, 255, 255, 0.60);
}
`;

const NOT_FOUND = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found</title>
${ICONS_MANIFEST_AND_THEME_COLORS}
<style>
${COMMON_STYLES}
</style>
</head>
<body>
  <div id="centered">Not found</div>
</body>
</html>`;

function computeHtml(url: URL, staticData: Record<string, unknown>) {
    const { name, description } = computeManifest();
    const { twitter } = staticData;
    const appJsPath = computeAppJsPath();
        return `<!DOCTYPE html>
<html lang="en" class="no-js">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">

<title>${encodeXml(name)}</title>

<script id="static-data-script" type="application/json">${JSON.stringify(staticData)}</script>
<script type="module">
    document.documentElement.classList.remove('no-js');
    document.documentElement.classList.add('js');
</script>

<link rel="modulepreload" href="${appJsPath}" as="script" />
<script id="app-module-script" type="module" src="${appJsPath}" onload="if (!this.dataset.state) { document.documentElement.classList.remove('js'); }"></script>

<meta name="description" content="${encodeXml(description)}">
<meta property="og:title" content="${encodeXml(name)}">
<meta property="og:description" content="${encodeXml(description)}">
<meta property="og:image" content="${url.origin}${TWITTER_IMAGE_PNG_PATHNAME}">
<meta property="og:image:alt" content="${encodeXml(name)} screenshot">
<meta property="og:locale" content="en_US">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
${twitter ? `<meta name="twitter:site" content="${twitter}">` : ''}
<meta property="og:url" content="${url.origin}">
<link rel="canonical" href="${url.origin}">

${ICONS_MANIFEST_AND_THEME_COLORS}

<style>
${COMMON_STYLES}

#centered a {
    color: ${Material.primaryColor300Hex};
    text-underline-offset: 0.2rem;
    text-decoration: none;
}

@media (hover: hover) {
    #centered a:hover {
        text-decoration: underline;
    }
}

.js #centered {
    display: none;
}

</style>
</head>
<body>
  <div id="centered">
    <div>${encodeXml(name)} requires a current version of:
      <ul>
        <li><a href="https://www.microsoft.com/en-us/edge" target="_blank">Microsoft Edge</a></li>
        <li><a href="http://www.google.com/chrome" target="_blank">Google Chrome</a></li>
        <li><a href="https://www.apple.com/safari/" target="_blank">Apple Safari</a></li>
        <li>or <a href="http://www.mozilla.com/en-US/firefox/new/" target="_blank">Mozilla Firefox</a></li>
        <li>... and <a href="https://www.enable-javascript.com/" target="_blank">JavaScript enabled</a> : )</li>
      </ul>
    </div>
  </div>
</body>
</html>`;
}
