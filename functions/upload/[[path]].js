// Cloudflare Pages Function: streams uploads from PUT requests directly into R2.
// Auth: Bearer token in Authorization header, compared against UPLOAD_TOKEN env var.
//
// Usage from any machine with curl (no disk space needed beyond the source file):
//   curl -X PUT \
//     -H "Authorization: Bearer <token>" \
//     --data-binary @localfile.mp4 \
//     https://mountzara.com/upload/destination-key.mp4
//
// Streams via Workers runtime so file size is bounded only by the R2 max
// object size (~5 TiB). No 300 MB dashboard limit.

export async function onRequestPut({ request, env, params }) {
    const provided = request.headers.get("authorization") || "";
    const expected = `Bearer ${env.UPLOAD_TOKEN || ""}`;
    if (!env.UPLOAD_TOKEN || provided !== expected) {
        return new Response("Unauthorized\n", { status: 401 });
    }

    if (!env.MEDIA) {
        return new Response("R2 binding 'MEDIA' not configured\n", { status: 500 });
    }

    // params.path is an array of path segments after /upload/
    const segments = Array.isArray(params.path) ? params.path : [params.path];
    const key = segments.join("/");
    if (!key) {
        return new Response("Missing object key in URL path\n", { status: 400 });
    }

    if (!request.body) {
        return new Response("Empty request body\n", { status: 400 });
    }

    const contentType = request.headers.get("content-type") || guessType(key);

    const result = await env.MEDIA.put(key, request.body, {
        httpMetadata: { contentType }
    });

    return new Response(JSON.stringify({
        ok: true,
        key,
        size: result.size,
        etag: result.httpEtag
    }, null, 2) + "\n", {
        status: 201,
        headers: { "Content-Type": "application/json" }
    });
}

// Block all other methods so the upload endpoint only accepts PUT.
export async function onRequest({ request }) {
    if (request.method === "PUT") return; // handled above
    return new Response("Method not allowed\n", {
        status: 405,
        headers: { "Allow": "PUT" }
    });
}

function guessType(key) {
    const lower = key.toLowerCase();
    if (lower.endsWith(".mp4")) return "video/mp4";
    if (lower.endsWith(".mov")) return "video/quicktime";
    if (lower.endsWith(".webm")) return "video/webm";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".png")) return "image/png";
    return "application/octet-stream";
}
