"""Shared Playwright launcher with container-Chromium fallback.

Why this exists (2026-07-22): the deploy-gate audits that render live
mountzara.com in a real browser (audit_runtime_css.py,
audit_visual_runtime.py, audit_route_render.py) were SILENTLY SKIPPING in
the remote deploy environment — `playwright` (Python) wasn't installed, and
even once installed, `p.chromium.launch()` demands the exact browser build
the pip version pins (e.g. chromium-1228) while the container pre-installs a
different build under /opt/pw-browsers (e.g. chromium-1194). A gate that
skips is a gate that doesn't exist, so:

  * `launch_chromium(p, **kw)` — native launch first; on failure, discover
    the container Chromium (env MZ_CHROMIUM_PATH → /opt/pw-browsers/chromium
    symlink → scan chromium-*/chrome-linux{,64}/chrome) and launch it with
    executable_path (+ --no-sandbox, required when running as root).
  * `launch_engine(p, engine, **kw)` — same, but for audits that want
    webkit/firefox: try the native engine; when it isn't installed, FALL
    BACK to container Chromium (device emulation still applies via the
    context) and say so in the returned note, instead of skipping the audit.

Returns (browser, engine_used, note). `note` is "" for a clean native
launch; otherwise a one-line human-readable explanation of the fallback,
which callers should print so the log never hides an engine substitution.
"""
from __future__ import annotations

import os
from glob import glob


def find_chromium_exe() -> str | None:
    """Locate a runnable Chromium binary without downloading anything."""
    env = os.environ.get("MZ_CHROMIUM_PATH")
    if env and os.path.exists(env):
        return env
    for cand in ("/opt/pw-browsers/chromium",):  # container-provided symlink
        if os.path.exists(cand):
            return cand
    root = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
    for pat in ("chromium-*/chrome-linux/chrome", "chromium-*/chrome-linux64/chrome"):
        hits = sorted(glob(os.path.join(root, pat)))
        if hits:
            return hits[-1]
    return None


def _with_no_sandbox(kwargs: dict) -> dict:
    kw = dict(kwargs)
    args = list(kw.get("args") or [])
    if "--no-sandbox" not in args:
        args.append("--no-sandbox")
    kw["args"] = args
    return kw


def _with_env_proxy(kwargs: dict) -> dict:
    """Pass the environment's egress proxy to the browser.

    Remote deploy containers route ALL outbound HTTPS through a local
    policy proxy (HTTPS_PROXY). Chromium launched by Playwright does not
    inherit env proxies, so without this every page.goto() to live
    mountzara.com dies with net::ERR_CONNECTION_RESET. Callers that
    navigate to live pages must also pass ignore_https_errors=True on the
    context (the proxy re-terminates TLS with its own CA) — the audits
    that goto() live URLs already do, with the rationale documented in
    audit_route_render.py.
    """
    if "proxy" in kwargs:
        return kwargs
    server = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
    if not server:
        return kwargs
    kw = dict(kwargs)
    # bypass for local addresses — the relay only accepts HTTPS CONNECT, so
    # plain-HTTP localhost requests (local preview servers) must go direct
    kw["proxy"] = {"server": server,
                   "bypass": os.environ.get("NO_PROXY", "localhost,127.0.0.1")}
    return kw


def _with_chromium_tls_cap(kwargs: dict) -> dict:
    """Chromium-ONLY launch args for the proxied container.

    The egress proxy's TLS-interception stack RESETS Chromium's TLS 1.3
    ClientHello (hybrid post-quantum key share); curl's 1.3 hello passes,
    every Chromium navigation died with net::ERR_CONNECTION_RESET
    (diagnosed 2026-07-22: raw CONNECT succeeds, handshake inside the
    tunnel resets; --ssl-version-max=tls1.2 → clean load with certificate
    verification still fully ON via the proxy CA in the NSS store).
    Capping the version is NOT disabling verification, and only applies
    here — inside a proxied container. On an unproxied machine (the Mac)
    this branch never runs.

    2026-08-09 — this used to live inside _with_env_proxy, which meant
    launch_engine('webkit') ALSO received the flag; WebKit dies at startup
    on the unknown Chromium switch ("browser has been closed"), so every
    'webkit' audit silently ran on Chromium instead. Engine-specific args
    stay with the engine.
    """
    if not (os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")):
        return kwargs
    kw = dict(kwargs)
    args = list(kw.get("args") or [])
    if not any(a.startswith("--ssl-version-max") for a in args):
        args.append("--ssl-version-max=tls1.2")
    kw["args"] = args
    return kw


def launch_chromium(p, **kwargs):
    """Launch Chromium: native install first, container binary as fallback.

    Returns (browser, "chromium", note).
    """
    kwargs = _with_chromium_tls_cap(_with_env_proxy(kwargs))
    try:
        return p.chromium.launch(**kwargs), "chromium", ""
    except Exception as native_err:
        exe = find_chromium_exe()
        if not exe:
            raise RuntimeError(
                f"chromium native launch failed ({str(native_err).splitlines()[0]}) "
                "and no container Chromium found under /opt/pw-browsers "
                "(set MZ_CHROMIUM_PATH to a chrome binary)"
            ) from native_err
        kw = _with_no_sandbox(kwargs)
        kw["executable_path"] = exe
        browser = p.chromium.launch(**kw)
        return browser, "chromium", f"chromium via container binary {exe}"


def launch_engine(p, engine: str, **kwargs):
    """Launch the requested engine, falling back to container Chromium.

    webkit/firefox are not installed in the remote deploy container; rather
    than skip the audit (a silent no-op gate), run the same assertions in
    Chromium with the device descriptor still applied at context level.
    Returns (browser, engine_used, note).
    """
    if engine == "chromium":
        return launch_chromium(p, **kwargs)
    kwargs = _with_env_proxy(kwargs)
    try:
        return getattr(p, engine).launch(**kwargs), engine, ""
    except Exception as native_err:
        browser, _, chromium_note = launch_chromium(p, **kwargs)
        note = (
            f"{engine} unavailable ({str(native_err).splitlines()[0][:80]}) — "
            f"FELL BACK to chromium"
            + (f" ({chromium_note})" if chromium_note else "")
        )
        return browser, "chromium", note
