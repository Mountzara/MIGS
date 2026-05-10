// Cloudflare Pages Function: serves media from R2 bucket binding
// Bound name: MEDIA (configured in dashboard)
// Routes: /media/<filename> → R2 object <filename>

export async function onRequestGet({ request, env }) {
    const url = new URL(request.url);
    // Strip leading "/media/" from the pathname
    const key = decodeURIComponent(url.pathname.replace(/^\/media\//, ""));

    if (!key) {
        return new Response("Not found", { status: 404 });
    }

    if (!env.MEDIA) {
        return new Response("R2 binding 'MEDIA' not configured", { status: 500 });
    }

    // Handle HTTP Range requests for video streaming
    const range = request.headers.get("range");
    const r2Options = {};
    if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        if (match) {
            const start = parseInt(match[1], 10);
            const end = match[2] ? parseInt(match[2], 10) : undefined;
            r2Options.range = end !== undefined
                ? { offset: start, length: end - start + 1 }
                : { offset: start };
        }
    }

    const object = await env.MEDIA.get(key, r2Options);
    if (!object) {
        return new Response("Video not found", { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("accept-ranges", "bytes");
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("content-type", object.httpMetadata?.contentType || "video/mp4");

    if (range && object.range) {
        const start = object.range.offset ?? 0;
        const length = object.range.length ?? object.size - start;
        const end = start + length - 1;
        headers.set("content-range", `bytes ${start}-${end}/${object.size}`);
        headers.set("content-length", String(length));
        return new Response(object.body, { status: 206, headers });
    }

    headers.set("content-length", String(object.size));
    return new Response(object.body, { status: 200, headers });
}
