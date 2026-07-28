#!/usr/bin/env node
// =====================================================================
// audit_video_sources.mjs — video PLAYABILITY gate (2026-07-22)
// =====================================================================
// The visual audit's browser cannot decode H.264 (Playwright Chromium has
// no proprietary codecs), so autoplay of the surgical reels was "verified"
// as codec-skipped — i.e. NOT verified, and a broken tile shipped silently.
// This gate verifies playability at the FILE level, which needs no browser:
// for every <video><source> URL referenced by the homepage it asserts the
// live file returns 200 video/mp4, is faststart (moov before mdat — a
// late moov stalls progressive playback), and that ffmpeg (full build via
// imageio-ffmpeg) can actually DECODE a frame. Hard-fails otherwise.
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { execFileSync } from "child_process";
const BASE = process.env.MZ_SITE_BASE || "https://mountzara.com";
let FF = null;
try { FF = execFileSync("python3", ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]).toString().trim(); } catch { /* absent */ }
const html = readFileSync("index.html", "utf8");
const urls = [...new Set([...html.matchAll(/<source src="(\/media\/[^"]+\.(?:mp4|webm))"/g)].map((m) => m[1]))];
if (!urls.length) { console.log("no video sources found — nothing to check"); process.exit(0); }
let failed = 0;
for (const u of urls) {
    try {
        const r = await fetch(`${BASE}${u}`, { headers: { Range: "bytes=0-262143" } });
        const ct = r.headers.get("content-type") || "";
        if (!(r.status === 200 || r.status === 206) || !/video|octet/.test(ct)) {
            console.error(`  ✗  ${u}: HTTP ${r.status} content-type=${ct}`); failed++; continue;
        }
        const head = Buffer.from(await r.arrayBuffer());
        if (u.endsWith(".mp4")) {
            const moov = head.indexOf("moov"), mdat = head.indexOf("mdat");
            if (moov < 0 || (mdat > 0 && moov > mdat)) {
                console.error(`  ✗  ${u}: moov not at front (not faststart) — stalls progressive autoplay`); failed++; continue;
            }
        }
        if (FF) {
            const tmp = `/tmp/_vsrc${urls.indexOf(u)}${u.endsWith("webm") ? ".webm" : ".mp4"}`;
            const full = await fetch(`${BASE}${u}`); writeFileSync(tmp, Buffer.from(await full.arrayBuffer()));
            try { execFileSync(FF, ["-v", "error", "-i", tmp, "-frames:v", "3", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] }); }
            catch (e) { console.error(`  ✗  ${u}: ffmpeg cannot decode (${String(e.stderr).slice(0, 120)})`); failed++; unlinkSync(tmp); continue; }
            unlinkSync(tmp);
        }
        console.log(`  ✓  ${u} — 200, faststart, decodes`);
    } catch (e) { console.error(`  ✗  ${u}: ${String(e.message).slice(0, 120)}`); failed++; }
}
if (failed) { console.error(`\nvideo-source gate: ${failed} unplayable source(s)`); process.exit(2); }
console.log(`\nvideo-source gate: CLEAN — all ${urls.length} sources playable`);
