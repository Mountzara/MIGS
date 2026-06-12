// CBG/MIGS Blog + Evidence Briefs API
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

// 2026-05-19 (Phase C): "claim_proposal" added so Claude can queue
// candidate trend-brief claims to the admin dashboard for clinician
// approval before they enter the active trend_watchlist.json.
const POST_KINDS = new Set(["blog", "evidence", "claim_proposal"]);
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

// §0.8.2 manifest completeness — the MountZaraResearchDigest pipeline writes
// only the FEATURED paper per topic group into pmids_cited (≈one per topic),
// not the full citation set. The authoritative "papers in this post" list is
// the set of deep-dive modal ids (dd-<PMID>). Backfill pmids_cited to that full
// set at ingestion so every draft carries a complete manifest with zero
// pipeline changes. Only ever EXPAND (never shrink to empty): a post with no
// modals (e.g. a non-cite-card surface) keeps whatever the pipeline supplied.
function citedPmidsFromBody(bodyHtml) {
    if (typeof bodyHtml !== "string") return [];
    const ids = new Set();
    const re = /id="dd-(\d+)"/g;
    let m;
    while ((m = re.exec(bodyHtml)) !== null) ids.add(m[1]);
    return [...ids].sort();
}

function backfillManifest(post) {
    const cited = citedPmidsFromBody(post.body_html);
    if (cited.length === 0) return post;            // nothing authoritative to add
    const supplied = Array.isArray(post.pmids_cited) ? post.pmids_cited : [];
    // Use the full modal set when the pipeline supplied fewer (the usual case),
    // or union if it somehow supplied extras (defensive — never lose a PMID).
    const union = new Set([...cited, ...supplied.map(String)]);
    if (union.size > supplied.length) post.pmids_cited = [...union].sort();
    return post;
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
    if (obj) {
        try {
            const parsed = JSON.parse(await obj.text());
            if (parsed && Array.isArray(parsed.posts)) return parsed;
        } catch { /* corrupt blob — fall through to self-heal */ }
    }
    // SELF-HEAL (2026-06-12): the index is missing or unparseable. Returning an
    // empty list here would silently hide EVERY post of this kind from the site
    // (a lost/garbled `_index/<kind>.json` = catastrophic-but-invisible outage).
    // Rebuild it from the posts/ objects instead. This path only runs when the
    // index is actually absent/corrupt — never on the normal read path — so it
    // adds no steady-state cost while guaranteeing the listing can't vanish.
    try {
        const entries = await rebuildIndex(env, kind);
        return { posts: entries, rebuilt_at: new Date().toISOString(), self_healed: true };
    } catch {
        return { posts: [] };
    }
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

export async function onRequest(ctx) {
    try {
        return await onRequestImpl(ctx);
    } catch (e) {
        // Surface the exception text instead of letting Cloudflare return
        // a generic 1101. Critical for diagnosing PUT/approve failures.
        const msg = (e && e.stack) ? String(e.stack) : String(e);
        console.error("api/posts onRequest threw:", msg);
        return new Response(
            JSON.stringify({ error: "internal_error", detail: msg.slice(0, 2000) }),
            { status: 500, headers: { "content-type": "application/json", "cache-control": "no-store" } },
        );
    }
}

async function onRequestImpl({ request, env, params }) {
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
                // PUBLIC listing is PUBLISHED-ONLY. Previously this returned
                // every status, so draft + rejected post metadata (titles,
                // summaries, the "trash-pipeline-test" ids) leaked to anyone who
                // GET /api/posts. Drafts/rejected are admin-only via the
                // authenticated /_admin listing. A `status` query param can only
                // NARROW within published — it can never expose non-published.
                if (p.status !== "published") continue;
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
        // Admin listing includes claim_proposal by default so Chris sees
        // pending candidate claims alongside drafts (Phase C). Public
        // /api/posts intentionally stays blog+evidence to avoid leaking
        // proposals via the public surface.
        const kinds = kind ? [kind] : ["blog", "evidence", "claim_proposal"];
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

        // Overwrite-protection guard (added 2026-05-27 after the audit
        // revealed that POST /api/posts had no dedup check — if
        // run_weekly_digest.sh re-fires for an already-rejected W22 or an
        // already-published W20/W21, the next POST would silently overwrite
        // the existing R2 post and un-tombstone the rejected draft, ship a
        // stale body, and revert any clinician-revised verdict/social-draft
        // patches. Now: refuse POST when the id already exists with status
        // in {published, rejected}. Operator can still PUT the post
        // explicitly to update editable fields. To intentionally recreate a
        // rejected post, first explicitly delete or DELETE-with-confirm via
        // the admin UI. To intentionally republish, use PUT with the
        // editable-fields whitelist (preserves R2 state)."""
        const existing = await readPost(env, String(body.id));
        if (existing) {
            const lockedStatuses = new Set(["published", "rejected"]);
            if (lockedStatuses.has(existing.status)) {
                return errorResponse(
                    `post ${body.id} already exists with status="${existing.status}" — ` +
                    `POST refused (overwrite-protection guard 2026-05-27). ` +
                    `Use PUT /api/posts/${body.id} to update editable fields, ` +
                    `or explicitly change status first via /reject or /approve. ` +
                    `This guard prevents a re-run of run_weekly_digest.sh / ` +
                    `run_trend_tracker.sh from silently un-tombstoning rejected drafts ` +
                    `or overwriting published content.`,
                    409  // Conflict
                );
            }
            // Existing draft — log the overwrite and proceed (drafts are
            // explicitly the editable working state). The audit gate at
            // publish_to_admin._post_draft has already verified the new
            // payload before it reaches this endpoint.
        }

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
        backfillManifest(post);   // §0.8.2: complete pmids_cited from the post's modals
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
        // Phase C side effect (2026-05-19): when approving a claim_proposal,
        // also write a pending_approvals/<id>.json blob to R2 so the
        // watchlist migration script (run on Chris's Mac via osascript
        // bash) can fold the approved candidate into trend_watchlist.json
        // claims[]. The blob is removed by the migration script once the
        // claim is appended and committed to the repo.
        if (post.kind === "claim_proposal") {
            try {
                const candidate = {
                    id: post.id,
                    approved_at: post.published_at,
                    claim_text: post.summary || post.title || "",
                    topic_tags: post.topics_covered || [],
                    source_pmids: post.pmids_cited || [],
                    title: post.title,
                };
                await env.CONTENT.put(
                    `pending_approvals/${post.id}.json`,
                    JSON.stringify(candidate, null, 2),
                    { httpMetadata: { contentType: "application/json" } },
                );
            } catch (e) {
                console.error("approve claim_proposal: pending_approvals write failed", {
                    module: "api/posts", op: "approve_claim_proposal",
                    id: post.id, error: e && e.message ? e.message : String(e),
                });
                // Non-fatal — the post is approved; migration just needs a retry.
            }
        }
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
        // Phase C side effect (2026-05-19): when rejecting a claim_proposal,
        // append the candidate's claim_text + slug to a permanent
        // rejected-history index so the discovery pipeline doesnt re-propose
        // the same claim next week. Entries can be removed later (e.g., 12-
        // month TTL or manual unreject) by editing the index.
        if (post.kind === "claim_proposal") {
            try {
                const idxObj = await env.CONTENT.get("claim_proposals/rejected_index.json");
                let idx = { entries: [] };
                if (idxObj) {
                    try { idx = JSON.parse(await idxObj.text()); } catch { /* keep empty */ }
                }
                if (!Array.isArray(idx.entries)) idx.entries = [];
                // Dedup by id
                if (!idx.entries.some(e => e.id === post.id)) {
                    idx.entries.unshift({
                        id: post.id,
                        rejected_at: new Date().toISOString(),
                        claim_text: post.summary || post.title || "",
                        topic_tags: post.topics_covered || [],
                    });
                    // Cap at 500 most-recent to bound size
                    idx.entries = idx.entries.slice(0, 500);
                    await env.CONTENT.put(
                        "claim_proposals/rejected_index.json",
                        JSON.stringify(idx, null, 2),
                        { httpMetadata: { contentType: "application/json" } },
                    );
                }
            } catch (e) {
                console.error("reject claim_proposal: rejected_index write failed", {
                    module: "api/posts", op: "reject_claim_proposal",
                    id: post.id, error: e && e.message ? e.message : String(e),
                });
            }
        }
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
        // Editable fields. Per CLAUDE.md §0.8.2 the 5 canonical structured
        // manifest fields (pmids_cited, kb_entries_retrieved, run_manifest_path,
        // topics_covered, gaps_surfaced) are ALL editable so the operator can
        // backfill them on older posts. `run_manifest_path` was missing from
        // the whitelist until 2026-05-26 — PUTs were silently dropping the
        // field, leaving 8 trend briefs with only 2-3/5 canonical fields.
        const editable = ["title", "summary", "body_html", "topics_covered", "pmids_cited",
                          "kb_entries_retrieved", "gaps_surfaced", "run_manifest_path",
                          "verdict", "linkedin_draft", "instagram_draft", "kind", "status"];
        for (const key of editable) {
            if (patch[key] !== undefined) post[key] = patch[key];
        }
        // Validate kind if it was changed
        if (post.kind !== oldKind && !POST_KINDS.has(post.kind)) {
            return errorResponse(`invalid kind: ${post.kind}`);
        }
        // Validate status if it was changed via PUT (2026-05-19 patch: allow
        // admin to flip rejected → draft or draft → published without needing
        // the dedicated /approve or /reject endpoints, so incident-recovery
        // rebuilds can fully restore any status state).
        if (patch.status !== undefined && !POST_STATUSES.has(post.status)) {
            return errorResponse(`invalid status: ${post.status}`);
        }
        // Stamp published_at when status flips to "published"; clear it when
        // status moves away from "published" so the public surface never
        // renders a stale timestamp on a now-non-public post.
        if (patch.status === "published" && !post.published_at) {
            post.published_at = new Date().toISOString();
        } else if (patch.status !== undefined && patch.status !== "published") {
            post.published_at = null;
        }
        backfillManifest(post);   // §0.8.2: keep pmids_cited complete after body edits
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
