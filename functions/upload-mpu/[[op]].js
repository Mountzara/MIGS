// Cloudflare Pages Function: chunked multipart upload to R2.
// Bypasses Cloudflare's 100MB request body limit by uploading in <100MB parts.
//
// Three operations driven by URL path:
//   POST /upload-mpu/init?key=<key>                    → { uploadId }
//   PUT  /upload-mpu/part?key=<key>&uploadId=<id>&partNumber=<n>
//        body: raw chunk bytes (max ~95MB)             → { etag }
//   POST /upload-mpu/complete?key=<key>&uploadId=<id>
//        body: JSON array [{partNumber, etag}, ...]    → { ok, key, etag, size }
//   POST /upload-mpu/abort?key=<key>&uploadId=<id>     → { ok }
//
// All require Authorization: Bearer <UPLOAD_TOKEN>.

function unauthorized(env, req) {
    const provided = req.headers.get("authorization") || "";
    return !env.UPLOAD_TOKEN || provided !== `Bearer ${env.UPLOAD_TOKEN}`;
}

function jsonResponse(obj, status = 200) {
    return new Response(JSON.stringify(obj) + "\n", {
        status,
        headers: { "Content-Type": "application/json" }
    });
}

export async function onRequest({ request, env, params }) {
    if (unauthorized(env, request)) {
        return new Response("Unauthorized\n", { status: 401 });
    }
    if (!env.MEDIA) {
        return new Response("R2 binding 'MEDIA' not configured\n", { status: 500 });
    }

    const url = new URL(request.url);
    const op = (Array.isArray(params.op) ? params.op[0] : params.op) || "";
    const key = url.searchParams.get("key") || "";
    const uploadId = url.searchParams.get("uploadId") || "";
    const partNumber = parseInt(url.searchParams.get("partNumber") || "0", 10);

    if (!key) return jsonResponse({ error: "missing key query param" }, 400);

    try {
        if (op === "init" && request.method === "POST") {
            const mpu = await env.MEDIA.createMultipartUpload(key, {
                httpMetadata: { contentType: guessType(key) }
            });
            return jsonResponse({ uploadId: mpu.uploadId, key });
        }

        if (op === "part" && request.method === "PUT") {
            if (!uploadId || !partNumber) {
                return jsonResponse({ error: "missing uploadId or partNumber" }, 400);
            }
            const mpu = env.MEDIA.resumeMultipartUpload(key, uploadId);
            const part = await mpu.uploadPart(partNumber, request.body);
            return jsonResponse({ partNumber, etag: part.etag });
        }

        if (op === "complete" && request.method === "POST") {
            if (!uploadId) return jsonResponse({ error: "missing uploadId" }, 400);
            const parts = await request.json();
            if (!Array.isArray(parts)) {
                return jsonResponse({ error: "body must be an array of parts" }, 400);
            }
            const mpu = env.MEDIA.resumeMultipartUpload(key, uploadId);
            const obj = await mpu.complete(parts);
            return jsonResponse({
                ok: true,
                key,
                etag: obj.httpEtag,
                size: obj.size
            }, 201);
        }

        if (op === "abort" && request.method === "POST") {
            if (!uploadId) return jsonResponse({ error: "missing uploadId" }, 400);
            const mpu = env.MEDIA.resumeMultipartUpload(key, uploadId);
            await mpu.abort();
            return jsonResponse({ ok: true });
        }

        return new Response(`unknown op '${op}' or wrong method ${request.method}\n`, {
            status: 400
        });
    } catch (err) {
        return jsonResponse({ error: String(err && err.message || err) }, 500);
    }
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
