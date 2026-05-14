// MIGS & CBG Blog + Evidence Briefs API
// ----------------------------------------------------------------
// Routes (all under /api/posts):
//   GET    /api/posts                       — list posts (filter: ?kind=blog|evidence&status=draft|published)
//   GET    /api/posts/:id                   — fetch one post
//   POST   /api/posts                       — create a draft (pipeline ingestion; requires X-Pipeline-Token)
//   POST   /api/posts/:id/approve           — flip status to "published" (CF Access required)
//   POST   /api/posts/:id/reject            — flip status to "rejected" (CF Access required)
//   PUT    /api/posts/:id                   — edit body / metadata (CF Access required)
//
// Storage: R2 bucket `mountzara-content` (binding = CONTENT)
//   Keys:
//     posts/<id>.json            — individual post
//     _index/blog.json           — sorted list of {id, status, ...summary fields}
//     _index/evidence.json       — same shape for trend briefs
//
// Auth model:
//   - GET endpoints are public (read-only).
//   - POST /api/posts (draft creation) requires header X-Pipeline-Token matching
//     env.PIPELINE_TOKEN — the Monday/Tuesday scheduled tasks set this when they
//     ingest new drafts.
//   - POST /api/posts/:id/approve|reject and PUT /api/posts/:id require a
//     Cloudflare Access JWT — env recognises Cf-Access-Jwt-Assertion AND/OR
//     Cf-Access-Authenticated-User-Email. Anything reaching this handler with
//     neither header is rejected 401.
//
// All clinical content remains draft-and-queue per CLAUDE.md §9.2 — posts only
// become publicly visible when status === "published".

const POST_KINDS = new Set(["blog", "evidence"]);
const POST_STATUSES = new Set(["draft", "published", "rejected"]);

function jsonResponse(body, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            ...extraHeaders,
        },
    });
}

function errorResponse(message, status = 400) {
    return jsonResponse({ error: message }, status);
}

// Same PBKDF2 verification used by /admin/_middleware.js — verifies a
// submitted Basic Auth password against ADMIN_PASS_HASH ("pbkdf2$iter$salt$hash").
async function verifyPbkdf2(password, stored) {
    if (typeof stored !== "string") return false;
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const iterations = parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations < 10000) return false;
    function b64ToBytes(b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    let salt, expected;
    try { salt = b64ToBytes(parts[2]); expected = b64ToBytes(parts[3]); } catch { return false; }
    const keyMaterial = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
        keyMaterial, expected.length * 8
    );
    const got = new Uint8Array(bits);
    if (got.length !== expected.length) return false;
    let m = 0;
    for (let i = 0; i < got.length; i++) m |= got[i] ^ expected[i];
    return m === 0;
}

async function isAdminRequest(request, env) {
    // Path 1: Cloudflare Access JWT headers (set up via dashboard).
    const accessEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
    const accessJwt = request.headers.get("Cf-Access-Jwt-Assertion");
    if (accessEmail || accessJwt) {
        if (env.ADMIN_EMAILS && accessEmail) {
            const allowed = env.ADMIN_EMAILS.split(",").map(s => s.trim().toLowerCase());
            if (allowed.length > 0 && !allowed.includes(accessEmail.toLowerCase())) return false;
        }
        return true;
    }
    // Path 2: HTTP Basic Auth (matches /admin/_middleware.js).
    const auth = request.headers.get("Authorization") || "";
    if (auth.startsWith("Basic ") && env.ADMIN_PASS_HASH) {
        try {
            const decoded = atob(auth.slice(6));
            const sep = decoded.indexOf(":");
            if (sep < 0) return false;
            const user = decoded.slice(0, sep);
            const pass = decoded.slice(sep + 1);
            // Email comparison is case-insensitive (mirrors the fix in
            // /admin/_middleware.js so iOS/Safari autocapitalization on
            // the email field doesn't break API auth either). Password
            // comparison stays exact-case via the PBKDF2 hash check.
            const expectedUser = (env.ADMIN_USER || "admin").trim().toLowerCase();
            const submittedUser = user.trim().toLowerCase();
            if (submittedUser !== expectedUser) return false;
            return await verifyPbkdf2(pass, env.ADMIN_PASS_HASH);
        } catch {
            return false;
        }
    }
    return false;
}

function isPipelineRequest(request, env) {
    const token = request.headers.get("X-Pipeline-Token");
    if (!token || !env.PIPELINE_TOKEN) return false;
    // Constant-time compare to avoid timing leaks
    if (token.length !== env.PIPELINE_TOKEN.length) return false;
    let mismatch = 0;
    for (let i = 0; i < token.length; i++) mismatch |= token.charCodeAt(i) ^ env.PIPELINE_TOKEN.charCodeAt(i);
    return mismatch === 0;
}

async function readPost(env, id) {
    const obj = await env.CONTENT.get(`posts/${id}.json`);
    if (!obj) return null;
    const text = await obj.text();
    try { return JSON.parse(text); } catch { return null; }
}

async function writePost(env, post) {
    post.updated_at = new Date().toISOString();
    await env.CONTENT.put(`posts/${post.id}.json`, JSON.stringify(post, null, 2), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
}

async function readIndex(env, kind) {
    const obj = await env.CONTENT.get(`_index/${kind}.json`);
    if (!obj) return { posts: [] };
    const text = await obj.text();
    try { return JSON.parse(text); } catch { return { posts: [] }; }
}

async function writeIndex(env, kind, index) {
    await env.CONTENT.put(`_index/${kind}.json`, JSON.stringify(index, null, 2), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
}

// Rebuild the index for a kind by listing posts/ — useful after manual edits
async function rebuildIndex(env, kind) {
    const list = await env.CONTENT.list({ prefix: "posts/" });
    const entries = [];
    for (const obj of list.objects) {
        const post = await env.CONTENT.get(obj.key).then(r => r.text()).then(JSON.parse);
        if (post.kind !== kind) continue;
        entries.push({
            id: post.id,
            kind: post.kind,
            status: post.status,
            week_label: post.week_label || null,
            title: post.title,
            summary: post.summary,
            topics_covered: post.topics_covered || [],
            verdict: post.verdict || null,
            created_at: post.created_at,
            published_at: post.published_at,
            updated_at: post.updated_at,
        });
    }
    entries.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    await writeIndex(env, kind, { posts: entries, rebuilt_at: new Date().toISOString() });
    return entries;
}

async function upsertIndexEntry(env, post) {
    const idx = await readIndex(env, post.kind);
    const summary = {
        id: post.id,
        kind: post.kind,
        status: post.status,
        week_label: post.week_label || null,
        title: post.title,
        summary: post.summary,
        topics_covered: post.topics_covered || [],
        verdict: post.verdict || null,
        created_at: post.created_at,
        published_at: post.published_at,
        updated_at: post.updated_at,
    };
    const existingIdx = idx.posts.findIndex(p => p.id === post.id);
    if (existingIdx >= 0) idx.posts[existingIdx] = summary;
    else idx.posts.unshift(summary);
    idx.posts.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    await writeIndex(env, post.kind, idx);
}

// -----------------------------------------------------------------------------
// Route dispatcher

export async function onRequest({ request, env, params }) {
    const url = new URL(request.url);
    const segments = (params.path || []).filter(Boolean);
    const method = request.method;

    if (!env.CONTENT) return errorResponse("R2 binding CONTENT not configured", 500);

    // GET /api/posts  (list)
    if (method === "GET" && segments.length === 0) {
        const kind = url.searchParams.get("kind");
        const status = url.searchParams.get("status");
        if (kind && !POST_KINDS.has(kind)) return errorResponse(`invalid kind: ${kind}`);
        if (status && !POST_STATUSES.has(status)) return errorResponse(`invalid status: ${status}`);
        const kinds = kind ? [kind] : ["blog", "evidence"];
        const combined = [];
        for (const k of kinds) {
            const idx = await readIndex(env, k);
            for (const p of idx.posts) {
                if (status && p.status !== status) continue;
                combined.push(p);
            }
        }
        combined.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
        return jsonResponse({ posts: combined });
    }

    // Admin routes — checked BEFORE the public single-id GET so /api/posts/_admin
    // isn't caught by the readPost("_admin") branch.
    //
    // GET /api/posts/_admin?kind=blog  (admin listing inc. drafts/rejected)
    if (method === "GET" && segments.length === 1 && segments[0] === "_admin") {
        if (!(await isAdminRequest(request, env))) return errorResponse("unauthorized", 401);
        const kind = url.searchParams.get("kind");
        if (kind && !POST_KINDS.has(kind)) return errorResponse(`invalid kind: ${kind}`);
        const kinds = kind ? [kind] : ["blog", "evidence"];
        const combined = [];
        for (const k of kinds) {
            const idx = await readIndex(env, k);
            for (const p of idx.posts) combined.push(p);
        }
        combined.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
        return jsonResponse({ posts: combined });
    }

    // GET /api/posts/_admin/:id  (admin fetch including drafts/rejected)
    if (method === "GET" && segments.length === 2 && segments[0] === "_admin") {
        if (!(await isAdminRequest(request, env))) return errorResponse("unauthorized", 401);
        const post = await readPost(env, segments[1]);
        if (!post) return errorResponse("not found", 404);
        return jsonResponse(post);
    }

    // POST /api/posts/_admin/rebuild_index?kind=blog  (admin maintenance)
    if (method === "POST" && segments.length === 2 && segments[0] === "_admin" && segments[1] === "rebuild_index") {
        if (!(await isAdminRequest(request, env))) return errorResponse("unauthorized", 401);
        const kind = url.searchParams.get("kind");
        if (!kind || !POST_KINDS.has(kind)) return errorResponse("must specify kind=blog|evidence");
        const entries = await rebuildIndex(env, kind);
        return jsonResponse({ ok: true, kind, count: entries.length });
    }

    // GET /api/posts/:id  (public — only published posts are served)
    if (method === "GET" && segments.length === 1) {
        const id = segments[0];
        const post = await readPost(env, id);
        if (!post) return errorResponse("not found", 404);
        // Drafts/rejected are not served publicly. Admin uses /api/posts/_admin/:id.
        if (post.status !== "published") return errorResponse("not found", 404);
        return jsonResponse(post);
    }

    // POST /api/posts  (create draft from pipeline)
    if (method === "POST" && segments.length === 0) {
        if (!isPipelineRequest(request, env)) return errorResponse("unauthorized", 401);
        let body;
        try { body = await request.json(); } catch { return errorResponse("invalid JSON body"); }
        if (!body.id) return errorResponse("missing id");
        if (!POST_KINDS.has(body.kind)) return errorResponse("invalid kind");
        const now = new Date().toISOString();
        const post = {
            id: String(body.id),
            kind: body.kind,
            status: body.status || "draft",
            week_label: body.week_label || null,
            title: body.title || "",
            summary: body.summary || "",
            body_html: body.body_html || "",
            topics_covered: Array.isArray(body.topics_covered) ? body.topics_covered : [],
            pmids_cited: Array.isArray(body.pmids_cited) ? body.pmids_cited : [],
            kb_entries_retrieved: Array.isArray(body.kb_entries_retrieved) ? body.kb_entries_retrieved : [],
            gaps_surfaced: Array.isArray(body.gaps_surfaced) ? body.gaps_surfaced : [],
            verdict: body.verdict || null,
            linkedin_draft: body.linkedin_draft || null,
            instagram_draft: body.instagram_draft || null,
            blog_html_path: body.blog_html_path || null,
            run_manifest_path: body.run_manifest_path || null,
            created_at: now,
            published_at: null,
            updated_at: now,
        };
        await writePost(env, post);
        await upsertIndexEntry(env, post);
        return jsonResponse({ ok: true, id: post.id }, 201);
    }

    // POST /api/posts/:id/approve  (admin)
    if (method === "POST" && segments.length === 2 && segments[1] === "approve") {
        if (!(await isAdminRequest(request, env))) return errorResponse("unauthorized", 401);
        const id = segments[0];
        const post = await readPost(env, id);
        if (!post) return errorResponse("not found", 404);
        post.status = "published";
        post.published_at = new Date().toISOString();
        await writePost(env, post);
        await upsertIndexEntry(env, post);
        return jsonResponse({ ok: true, id: post.id, status: post.status });
    }

    // POST /api/posts/:id/reject  (admin)
    if (method === "POST" && segments.length === 2 && segments[1] === "reject") {
        if (!(await isAdminRequest(request, env))) return errorResponse("unauthorized", 401);
        const id = segments[0];
        const post = await readPost(env, id);
        if (!post) return errorResponse("not found", 404);
        post.status = "rejected";
        await writePost(env, post);
        await upsertIndexEntry(env, post);
        return jsonResponse({ ok: true, id: post.id, status: post.status });
    }

    // PUT /api/posts/:id  (admin edit)
    if (method === "PUT" && segments.length === 1) {
        if (!(await isAdminRequest(request, env))) return errorResponse("unauthorized", 401);
        const id = segments[0];
        const post = await readPost(env, id);
        if (!post) return errorResponse("not found", 404);
        let patch;
        try { patch = await request.json(); } catch { return errorResponse("invalid JSON body"); }
        // Allow editing a known subset of fields. `kind` is included so an
        // admin can re-categorize a post (e.g. move a draft from the
        // influencer feed to the physician journal-club feed); when kind
        // changes we also need to drop the post from the OLD index, since
        // upsertIndexEntry only writes to the new index. We do that by
        // capturing the prior kind here, then calling rebuildIndex on the
        // old kind after the write — that re-lists posts/* and re-emits the
        // index with the now-no-longer-matching post excluded.
        const oldKind = post.kind;
        const editable = ["title", "summary", "body_html", "topics_covered", "pmids_cited",
                          "kb_entries_retrieved", "gaps_surfaced", "verdict",
                          "linkedin_draft", "instagram_draft", "kind"];
        for (const key of editable) {
            if (patch[key] !== undefined) post[key] = patch[key];
        }
        // Validate kind if it was changed
        if (post.kind !== oldKind && !POST_KINDS.has(post.kind)) {
            return errorResponse(`invalid kind: ${post.kind}`);
        }
        await writePost(env, post);
        await upsertIndexEntry(env, post);
        if (post.kind !== oldKind) {
            // Rebuild the old kind's index so the migrated post no longer
            // appears under its previous category. Failure here is non-fatal
            // for the PUT (the post itself is correctly written), but log it
            // per §4.4 so a stale index can be diagnosed.
            try {
                await rebuildIndex(env, oldKind);
            } catch (e) {
                console.error("posts.PUT rebuildIndex(oldKind) failed", {
                    module: "api/posts",
                    op: "rebuildIndex",
                    oldKind, newKind: post.kind, id: post.id,
                    error: e && e.message ? e.message : String(e),
                });
            }
        }
        return jsonResponse({ ok: true, id: post.id });
    }

    return errorResponse("method not allowed", 405);
}
