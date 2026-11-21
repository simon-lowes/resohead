#!/usr/bin/env python3
"""Snapshot resohead.com (WordPress.com) into a self-contained static site.

Fetches the live pages, downloads every asset they use (HTML, CSS, JS,
fonts, images, downloads, the VideoPress video), rewrites URLs to local
paths and strips WordPress.com tracking and dynamic bits.

Usage: python3 -I tools/snapshot.py tools/requests.txt && tools/split-large.sh
The optional file lists URLs recorded from a real browser (tools/record.mjs)
so lazily loaded assets are caught as well.
"""
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "site", "public")
CACHE = os.path.join(ROOT, ".cache")
# Where pages are fetched from. resohead.com redirects to the WordPress.com
# staging address since Nov 2026; override with SNAPSHOT_SOURCE if that changes.
ORIGIN = os.environ.get("SNAPSHOT_SOURCE", "https://resohead.wpcomstaging.com")
SITE_HOST = urllib.parse.urlsplit(ORIGIN).netloc
# The address the clone is published at: canonical and og: URLs point here.
PUBLIC_ORIGIN = "https://resohead.com"
SITE_HOSTS = {SITE_HOST, "resohead.com", "resohead.wpcomstaging.com"}

PAGES = {"/": "index.html", "/this-page-does-not-exist/": "404.html"}

# Hosts whose files are copied locally. Anything else (YouTube, Vimeo,
# SoundCloud, Bandcamp, PayPal...) stays an external link or embed.
LOCAL_HOSTS = SITE_HOSTS | {
    "i0.wp.com", "i1.wp.com", "i2.wp.com", "s0.wp.com",
    "s1.wp.com", "s2.wp.com", "fonts.wp.com", "videos.files.wordpress.com",
    "videopress.com", "v0.wordpress.com",
}

# Scripts and links that only make sense on WordPress.com.
DROP_SCRIPT = re.compile(
    r"stats\.wp\.com|bilmur|wpcloud-bot-protection|wp-emoji-release|"
    r"wpEmojiSettings|_stq|token-bridge|videopress-iframe|blackbox|"
    r"wpcom-actionbar|hovercards",
    re.I)
DROP_LINK = re.compile(
    r"rel=['\"](?:EditURI|alternate|https://api\.w\.org/|shortlink|"
    r"dns-prefetch|preconnect|pingback|search)['\"]|wp-json|xmlrpc|"
    r"oembed|/feed/", re.I)

URL_RE = re.compile(
    # Commas only inside a URL (concatenated "??a.js,b.js" bundles), never
    # the ", " between srcset candidates.
    r"(?:https?:)?(?:\\?/){2}(?:%s)(?:\\?/(?:[^\s\"'()<>,\\]|,(?=[^\s\"']))*(?:\\/(?:[^\s\"'()<>,\\]|,(?=[^\s\"']))*)*)?"
    % "|".join(re.escape(h) for h in sorted(LOCAL_HOSTS, key=len, reverse=True)))

mapped = {}       # absolute url -> local path ("/...")
failed = []


def fetch(url):
    key = hashlib.sha1(url.encode()).hexdigest()
    path = os.path.join(CACHE, key)
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read()
    # curl with its own user agent: the image CDN 404s urllib, and
    # WordPress.com rate-limits a browser user agent coming from a server.
    tmp = path + ".part"
    os.makedirs(CACHE, exist_ok=True)
    for attempt in range(6):
        r = subprocess.run(["curl", "-sS", "-L", "-o", tmp, "-w", "%{http_code} %{content_type}", url],
                           capture_output=True, text=True, timeout=900)
        code, _, ctype = r.stdout.strip().partition(" ")
        if code not in ("429", "000") and not code.startswith("5"):
            break
        print(f"HTTP {code}, retrying: {url}", file=sys.stderr)
        time.sleep(5 * 2 ** attempt)
    ok = code == "200" or (code == "404" and url.endswith("/this-page-does-not-exist/"))
    if not ok:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise RuntimeError(f"HTTP {code} {r.stderr.strip()}")
    with open(tmp, "rb") as f:
        data = f.read()
    os.remove(tmp)
    with open(path + ".type", "w") as f:
        f.write(ctype)
    with open(path, "wb") as f:
        f.write(data)
    return data


def normalise(raw):
    u = html.unescape(raw.replace("\\/", "/"))
    if u.startswith("//"):
        u = "https:" + u
    return u.replace("http://", "https://", 1)


def local_path(url):
    p = urllib.parse.urlsplit(url)
    path = urllib.parse.unquote(p.path) or "/"
    if path.endswith("/"):
        path += "index.html"
    q = p.query
    if p.netloc in SITE_HOSTS:
        # Version-only query strings are cache busters: keep the real path.
        keep = [kv for kv in q.split("&") if kv and kv.split("=")[0] not in ("ver", "m")]
        q = "&".join(keep)
        prefix = ""
    else:
        prefix = "/_ext/" + p.netloc
    base, ext = os.path.splitext(path)
    if q:
        # Query selects a variant (resized image, concatenated bundle): hash it in.
        base = base + "." + hashlib.sha1(q.encode()).hexdigest()[:10]
    # Image CDN paths embed the source host; name them after the public one.
    return (prefix + base + ext).replace("/" + SITE_HOST + "/", "/" + urllib.parse.urlsplit(PUBLIC_ORIGIN).netloc + "/")


def ext_for(url):
    """Extension for a concatenated bundle, from the Content-Type it was served with."""
    try:
        with open(os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest()) + ".type") as f:
            ctype = f.read()
    except FileNotFoundError:
        ctype = ""
    return ".css" if "css" in ctype or "cssminify" in url else ".js"


def save(local, data):
    dest = os.path.join(OUT, local.lstrip("/"))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)


def localise(url, base=None):
    """Download url (and its own dependencies), return its local path."""
    url = urllib.parse.urljoin(base, url) if base else url
    url = url.split("#")[0]
    if url in mapped:
        return mapped[url]
    host = urllib.parse.urlsplit(url).netloc
    if host not in LOCAL_HOSTS:
        return url
    local = local_path(url)
    mapped[url] = local
    try:
        data = fetch(url)
    except Exception as e:  # noqa: BLE001
        failed.append(f"{url}  ({e})")
        return local
    if "??" in url or "/_static/" in url:
        local = re.sub(r"(\.[0-9a-f]{10})(\.[a-z0-9]+)?$", r"\1" + ext_for(url), local)
        mapped[url] = local
    low = local.lower()
    if low.endswith(".css"):
        data = rewrite_css(data.decode("utf-8", "replace"), url).encode()
    elif low.endswith((".js", ".mjs")):
        data = rewrite_text(data.decode("utf-8", "replace"), url).encode()
    save(local, data)
    return local


def rewrite_css(css, base):
    def repl(m):
        raw = m.group(2).strip()
        if raw.startswith("data:") or not raw:
            return m.group(0)
        return f"url({m.group(1)}{localise(normalise(raw), base)}{m.group(1)})"
    css = re.sub(r"url\(\s*(['\"]?)([^'\")]+)\1\s*\)", repl, css)
    css = re.sub(r"@import\s+(['\"])([^'\"]+)\1",
                 lambda m: f"@import {m.group(1)}{localise(normalise(m.group(2)), base)}{m.group(1)}", css)
    return rewrite_text(css, base)


def rewrite_text(text, base=None):
    def repl(m):
        raw = m.group(0)
        u = normalise(raw)
        p = urllib.parse.urlsplit(u)
        if p.netloc in SITE_HOSTS and "/_static/" not in p.path and (p.path in ("", "/") or not os.path.splitext(p.path)[1]):
            # A page link, not a file.
            if p.path.startswith(("/wp-json", "/xmlrpc", "/wp-admin", "/wp-login", "/feed", "/?")):
                return raw
            loc = (p.path or "/") + (("?" + p.query) if p.query else "") + (("#" + p.fragment) if p.fragment else "")
        elif p.netloc in SITE_HOSTS and p.path == "/wp-admin/admin-ajax.php":
            loc = p.path
        elif p.netloc in SITE_HOSTS and p.path.startswith(("/wp-admin", "/wp-login", "/wp-json")):
            return raw
        else:
            loc = localise(u)
        if "\\/" in raw:
            loc = loc.replace("/", "\\/")
        if "&#038;" in raw or "&amp;" in raw:
            loc = loc.replace("&", "&amp;")
        return loc
    return URL_RE.sub(repl, text)


def strip_wpcom(page):
    # Scripts: drop tracking / WordPress.com-only ones, inline and external.
    def script(m):
        return "" if DROP_SCRIPT.search(m.group(0)) else m.group(0)
    page = re.sub(r"<script\b[^>]*>[\s\S]*?</script>", script, page)
    page = re.sub(r"<script\b[^>]*/>", script, page)
    page = re.sub(r"<link\b[^>]*>", lambda m: "" if DROP_LINK.search(m.group(0)) else m.group(0), page)
    page = re.sub(r"<meta name=['\"]generator['\"][^>]*>\s*", "", page)
    page = re.sub(r"<img[^>]+pixel\.wp\.com[^>]*>", "", page)
    page = re.sub(r"<iframe[^>]+(?:likes-master|widgets\.wp\.com)[^>]*>\s*</iframe>", "", page)
    return page


def replace_videopress(page):
    """Swap VideoPress iframes for a native <video> of the same file."""
    def repl(m):
        tag = m.group(0)
        guid = re.search(r"videopress\.com/embed/([A-Za-z0-9]+)", tag).group(1)
        info = json.loads(fetch(f"https://public-api.wordpress.com/rest/v1.1/videos/{guid}"))
        files = info.get("files", {})
        src = None
        for q in ("hd", "dvd", "std"):
            f = files.get(q) or {}
            if f.get("mp4"):
                src = f"https://videos.files.wordpress.com/{guid}/{f['mp4']}"
                break
        src = src or info["original"]
        poster = info.get("poster")
        pm = re.search(r"posterUrl=([^&\"]+)", tag)
        if pm:
            poster = urllib.parse.unquote(html.unescape(pm.group(1)))
        w = re.search(r'width="(\d+)"', tag)
        h = re.search(r'height="(\d+)"', tag)
        # Same box as the iframe it replaces, baseline gap included.
        style = "width:100%;vertical-align:baseline;background:#000"
        if w and h:
            style += f";aspect-ratio:{w.group(1)}/{h.group(1)}"
        attrs = f'controls preload="metadata" playsinline style="{style}"'
        if poster:
            attrs += f' poster="{localise(poster)}"'
        return f'<video {attrs} src="{localise(src)}"></video>'
    page = re.sub(r"<iframe[^>]+videopress\.com/embed/[^>]*>\s*</iframe>", repl, page)
    return page


def extract_forms(page, forms):
    """Record each Jetpack form's fields so the server can label submissions."""
    for m in re.finditer(r"data-wp-context='(\{\"fieldId\"[^']*)'", page):
        ctx = json.loads(html.unescape(m.group(1)))
        form = forms.setdefault(ctx["formHash"], {})
        form[ctx["fieldId"]] = {
            "label": ctx.get("fieldLabel") or ctx["fieldId"],
            "type": ctx.get("fieldType", "text"),
            "required": ctx.get("fieldIsRequired") in ("1", 1, True),
        }


def build_page(path, name, forms):
    page = fetch(ORIGIN + path).decode("utf-8")
    page = strip_wpcom(page)
    page = replace_videopress(page)
    extract_forms(page, forms)
    page = rewrite_text(page)
    # Social previews and search engines need absolute URLs on the public host.
    page = re.sub(r'(<meta (?:property|name)="(?:og:url|og:image|twitter:image)" content=")(/[^"]*)"',
                  lambda m: f'{m.group(1)}{PUBLIC_ORIGIN}{m.group(2)}"', page)
    page = re.sub(r"(<link rel=['\"]canonical['\"] href=['\"])(/[^'\"]*)",
                  lambda m: m.group(1) + PUBLIC_ORIGIN + m.group(2), page)
    # Anything left on the source host (e.g. config blobs) names the public one.
    page = page.replace("https://" + SITE_HOST, PUBLIC_ORIGIN).replace("https:\\/\\/" + SITE_HOST, PUBLIC_ORIGIN.replace("/", "\\/"))
    save("/" + name, page.encode())


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    forms = {}
    for path, name in PAGES.items():
        build_page(path, name, forms)
    with open(os.path.join(ROOT, "site", "forms.json"), "w") as f:
        json.dump(forms, f, indent=1)  # keep form field order
    if len(sys.argv) > 1:
        for line in open(sys.argv[1]):
            u = line.strip()
            if not u or u.startswith("blob:"):
                continue
            host = urllib.parse.urlsplit(u).netloc
            path = urllib.parse.urlsplit(u).path
            if host in LOCAL_HOSTS and host not in ("videopress.com", "v0.wordpress.com") and "_static/??" not in u \
                    and not DROP_SCRIPT.search(u) and os.path.splitext(path)[1]:
                localise(u)
    with open(os.path.join(ROOT, "site", "url-map.json"), "w") as f:
        json.dump(mapped, f, indent=1, sort_keys=True)
    print(f"{len(mapped)} assets, {len(failed)} failed")
    for x in failed:
        print("FAILED", x)


if __name__ == "__main__":
    main()
