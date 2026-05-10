// Test endpoint: /videos/ should return this JSON
export async function onRequestGet({ env }) {
    if (!env.MEDIA) {
        return new Response(JSON.stringify({
            error: "R2 binding 'MEDIA' not configured in Cloudflare dashboard",
            instructions: "Add R2 bucket binding named MEDIA pointing to mountzara-media bucket"
        }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }

    // List files in the R2 bucket
    const listed = await env.MEDIA.list({ limit: 100 });

    return new Response(JSON.stringify({
        status: "R2 binding active",
        bucket: "mountzara-media",
        files: listed.objects.map(obj => ({
            key: obj.key,
            size: obj.size,
            uploaded: obj.uploaded
        }))
    }, null, 2), {
        headers: { "Content-Type": "application/json" }
    });
}
