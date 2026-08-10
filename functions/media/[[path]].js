// Cloudflare Pages Function: serves media from R2 bucket binding
// Bound name: MEDIA (configured in dashboard)
// Routes: /media/<filename> → R2 object <filename>

function contentTypeFor(key) {
    const lower = key.toLowerCase();
    if (lower.endsWith(".mp4")) return "video/mp4";
    if (lower.endsWith(".mov")) return "video/quicktime";
    if (lower.endsWith(".webm")) return "video/webm";
    if (lower.endsWith(".m4v")) return "video/mp4";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".webp")) return "image/webp";
    return "application/octet-stream";
}

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

    // ?replay — byte-unique animated-WebP replay (2026-08-10). Safari keeps a
    // DECODED-animation cache keyed by CONTENT: on a repeat visit an identical
    // play-once animated WebP is shown already settled on its FINAL frame, so
    // the hero drawing never replays (the user's third recording). A client-
    // side fix (fetch + pad + blob URL) fails outright in some WebKit builds,
    // which refuse to decode a large animated WebP from a blob: URL. So the
    // server pads instead: append a 12-byte no-op XTRA chunk with a random
    // payload and fix up the RIFF size — every response is a valid, unique
    // WebP that can never hit the decoded cache. no-store because each
    // response is intentionally different.
    if (url.searchParams.has("replay") && key.toLowerCase().endsWith(".webp")) {
        const obj = await env.MEDIA.get(key);       // full object, no range
        if (!obj) {
            return new Response("Not found", { status: 404 });
        }
        const src = new Uint8Array(await obj.arrayBuffer());
        const out = new Uint8Array(src.length + 12);
        out.set(src);
        out.set([0x58, 0x54, 0x52, 0x41, 4, 0, 0, 0], src.length); // 'XTRA' + size 4
        const rnd = crypto.getRandomValues(new Uint8Array(4));
        out.set(rnd, src.length + 8);
        const riffSize = out.length - 8;
        out[4] = riffSize & 255;
        out[5] = (riffSize >> 8) & 255;
        out[6] = (riffSize >> 16) & 255;
        out[7] = (riffSize >> 24) & 255;
        return new Response(out, {
            status: 200,
            headers: {
                "content-type": "image/webp",
                "content-length": String(out.length),
                // briefly cacheable, NOT no-store: the client fetch()es the
                // full file first and then sets img.src to the SAME URL so
                // playback starts with every byte local (a streamed animated
                // WebP freezes mid-draw whenever the network falls behind —
                // user-reported). Each URL carries a unique t= param, so this
                // never resurrects the decoded-final-frame problem.
                "cache-control": "private, max-age=300",
                "x-content-type-options": "nosniff",
            },
        });
    }

    const object = await env.MEDIA.get(key, r2Options);
    if (!object) {
        return new Response("Video not found", { status: 404 });
    }

    // Force content-type based on extension - don't trust R2 metadata
    const forcedType = contentTypeFor(key);

    const headers = new Headers();
    headers.set("etag", object.httpEtag);
    headers.set("accept-ranges", "bytes");
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("content-type", forcedType);
    headers.set("x-content-type-options", "nosniff");

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
