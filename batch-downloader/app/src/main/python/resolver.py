import json
import re
import urllib.request
import urllib.error
import html as htmlmod
import yt_dlp

UA = "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36"

def _headers(referer=None):
    h = {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "*/*",
    }
    if referer:
        h["Referer"] = referer
    return h

def _safe_text(v, limit=180):
    if v is None:
        return ""
    s = str(v).replace("\n", " ").replace("\r", " ").strip()
    return s[:limit]

def _quality_height(quality):
    q = (quality or "Best").lower()
    if q == "hd":
        return 1080
    if q == "sd":
        return 480
    return None

def _pick_progressive(info, quality):
    formats = info.get("formats") or []
    max_h = _quality_height(quality)
    candidates = []
    for f in formats:
        if not isinstance(f, dict):
            continue
        url = f.get("url")
        if not url or not str(url).startswith(("http://", "https://")):
            continue
        vcodec = f.get("vcodec")
        acodec = f.get("acodec")
        if not vcodec or vcodec == "none":
            continue
        if not acodec or acodec == "none":
            continue
        h = f.get("height") or 0
        if max_h and h and h > max_h:
            continue
        ext = (f.get("ext") or "").lower()
        proto = (f.get("protocol") or "").lower()
        score = 0
        score += int(h or 0) * 20
        score += int(f.get("tbr") or 0)
        if ext == "mp4":
            score += 5000
        if proto.startswith("http"):
            score += 1500
        if f.get("filesize") or f.get("filesize_approx"):
            score += 50
        candidates.append((score, f))

    if not candidates and max_h:
        for f in formats:
            if not isinstance(f, dict):
                continue
            url = f.get("url")
            if not url or not str(url).startswith(("http://", "https://")):
                continue
            if f.get("vcodec") in (None, "none") or f.get("acodec") in (None, "none"):
                continue
            ext = (f.get("ext") or "").lower()
            h = f.get("height") or 0
            score = int(h or 0) * 20 + int(f.get("tbr") or 0)
            if ext == "mp4":
                score += 5000
            candidates.append((score, f))

    if candidates:
        candidates.sort(key=lambda x: x[0], reverse=True)
        return candidates[0][1]

    url = info.get("url")
    if url and str(url).startswith(("http://", "https://")):
        return info
    return None


def _fb_video_id(url):
    patterns = [
        r"/reel/(\\d+)",
        r"/videos/(?:[^/?#]+/)?(\\d+)",
        r"[?&]v=(\\d+)",
        r"story_fbid=(\\d+)",
    ]
    for p in patterns:
        m = re.search(p, url, re.I)
        if m:
            return m.group(1)
    return ""

def _fb_clean_url(url):
    vid = _fb_video_id(url)
    if vid:
        return f"https://www.facebook.com/reel/{vid}/"
    try:
        from urllib.parse import urlsplit, urlunsplit
        p = urlsplit(url)
        return urlunsplit((p.scheme or "https", p.netloc, p.path, "", ""))
    except Exception:
        return url.split("?")[0]

def _decode_fb(s):
    if not s:
        return ""
    s = htmlmod.unescape(str(s))
    replacements = {
        r"\\/": "/",
        r"\\u0025": "%",
        r"\\u0026": "&",
        r"\\u003d": "=",
        r"\\u003D": "=",
        r"\\u003f": "?",
        r"\\u003F": "?",
        r"\\u002f": "/",
        r"\\u002F": "/",
        r"\\u003a": ":",
        r"\\u003A": ":",
    }
    for a, b in replacements.items():
        s = s.replace(a, b)
    try:
        s = bytes(s, "utf-8").decode("unicode_escape")
    except Exception:
        pass
    return s.replace("\\/", "/").replace("&amp;", "&")

def _fb_extract_fields_from_obj(node, found, depth=0):
    if depth > 14 or node is None:
        return
    if isinstance(node, dict):
        for k, v in node.items():
            if k in (
                "browser_native_hd_url", "playable_url_quality_hd",
                "browser_native_sd_url", "playable_url",
                "hd_src", "sd_src", "hdUrl", "sdUrl",
                "progressive_url", "videoUrl"
            ) and isinstance(v, str) and v.startswith(("http://", "https://")):
                found.setdefault(k, _decode_fb(v))
            _fb_extract_fields_from_obj(v, found, depth + 1)
    elif isinstance(node, list):
        for v in node[:200]:
            _fb_extract_fields_from_obj(v, found, depth + 1)

def _fb_extract_page(html, quality):
    normalized = htmlmod.unescape(html or "")
    found = {}

    field_patterns = {
        "browser_native_hd_url": [
            r'"browser_native_hd_url"\\s*:\\s*"([^"]+)"',
            r'browser_native_hd_url\\s*:\\s*"([^"]+)"',
        ],
        "playable_url_quality_hd": [
            r'"playable_url_quality_hd"\\s*:\\s*"([^"]+)"',
            r'playable_url_quality_hd\\s*:\\s*"([^"]+)"',
        ],
        "hd_src": [
            r'"hd_src"\\s*:\\s*"([^"]+)"',
            r'hd_src\\s*:\\s*"([^"]+)"',
            r'"hdUrl"\\s*:\\s*"([^"]+)"',
        ],
        "browser_native_sd_url": [
            r'"browser_native_sd_url"\\s*:\\s*"([^"]+)"',
            r'browser_native_sd_url\\s*:\\s*"([^"]+)"',
        ],
        "playable_url": [
            r'"playable_url"\\s*:\\s*"([^"]+)"',
            r'playable_url\\s*:\\s*"([^"]+)"',
        ],
        "sd_src": [
            r'"sd_src"\\s*:\\s*"([^"]+)"',
            r'sd_src\\s*:\\s*"([^"]+)"',
            r'"sdUrl"\\s*:\\s*"([^"]+)"',
            r'"progressive_url"\\s*:\\s*"([^"]+)"',
        ],
    }
    for key, pats in field_patterns.items():
        for p in pats:
            m = re.search(p, normalized, re.I | re.S)
            if m:
                found[key] = _decode_fb(m.group(1))
                break

    # Modern Facebook often embeds large JSON blobs in application/json scripts.
    for sm in re.finditer(r'<script[^>]+type=["\\\']application/json["\\\'][^>]*>(.*?)</script>', normalized, re.I | re.S):
        blob = sm.group(1).strip()
        if not blob or len(blob) > 4_000_000:
            continue
        try:
            obj = json.loads(blob)
            _fb_extract_fields_from_obj(obj, found)
        except Exception:
            pass

    # Last-resort scan for escaped CDN mp4 URLs.
    generic = re.findall(r'https?:\\?/\\?/[^"\\\'<> ]+?\\.mp4(?:[^"\\\'<> ]*)?', normalized, re.I)
    generic = [_decode_fb(x) for x in generic if x]

    q = (quality or "Best").lower()
    hd = (
        found.get("browser_native_hd_url")
        or found.get("playable_url_quality_hd")
        or found.get("hd_src")
    )
    sd = (
        found.get("browser_native_sd_url")
        or found.get("playable_url")
        or found.get("sd_src")
    )

    if q == "sd":
        chosen = sd or hd
        height = 480 if sd else 720
    else:
        chosen = hd or sd
        height = 720 if hd else 480

    if not chosen and generic:
        chosen = generic[0]
        height = 0

    if not chosen:
        return None

    tm = re.search(r'<meta[^>]+(?:property|name)=["\\\']og:title["\\\'][^>]+content=["\\\']([^"\\\']+)', normalized, re.I)
    if not tm:
        tm = re.search(r'<title[^>]*>(.*?)</title>', normalized, re.I | re.S)
    title = htmlmod.unescape(tm.group(1)).strip() if tm else "Facebook Reel"

    return {
        "ok": True,
        "title": _safe_text(title, 120),
        "media_url": chosen,
        "ext": "mp4",
        "height": height,
        "thumbnail": "",
        "headers": {
            "User-Agent": UA,
            "Referer": "https://www.facebook.com/",
        },
    }

def _facebook_direct(url, quality="Best"):
    clean = _fb_clean_url(url)
    vid = _fb_video_id(clean)
    candidates = [clean]

    if vid:
        candidates += [
            f"https://m.facebook.com/watch/?v={vid}",
            f"https://m.facebook.com/reel/{vid}/",
            f"https://mbasic.facebook.com/watch/?v={vid}",
            f"https://www.facebook.com/watch/?v={vid}",
        ]

    # Try both desktop and iPhone-like mobile headers because the returned
    # logged-out HTML differs and one often contains progressive URLs.
    uas = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    ]

    last_error = ""
    for page in list(dict.fromkeys(candidates)):
        for ua in uas:
            try:
                req = urllib.request.Request(page, headers={
                    "User-Agent": ua,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                    "Upgrade-Insecure-Requests": "1",
                    "Sec-Fetch-Mode": "navigate",
                })
                with urllib.request.urlopen(req, timeout=20) as r:
                    body = r.read(6_000_000).decode("utf-8", "ignore")
                result = _fb_extract_page(body, quality)
                if result:
                    result["webpage_url"] = clean
                    result["source"] = "facebook-fallback"
                    return result
            except Exception as e:
                last_error = _safe_text(e, 160)

    return {
        "ok": False,
        "error": "Facebook public page থেকে direct MP4 পাওয়া যায়নি"
            + ((": " + last_error) if last_error else "")
    }

def resolve_video(url, quality="Best"):
    try:
        low = (url or "").lower()
        if "facebook.com" in low or "fb.watch" in low or "fb.com" in low:
            fb = _facebook_direct(url, quality)
            if fb.get("ok"):
                return json.dumps(fb)

        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "noplaylist": True,
            "http_headers": _headers(url),
            "socket_timeout": 20,
            "retries": 2,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)

        if not info:
            return json.dumps({"ok": False, "error": "Video info পাওয়া যায়নি"})

        if info.get("entries"):
            for e in info.get("entries") or []:
                if e:
                    info = e
                    break

        fmt = _pick_progressive(info, quality)
        if not fmt:
            return json.dumps({
                "ok": False,
                "error": "Single-file video stream পাওয়া যায়নি। এই link-এ আলাদা video/audio stream থাকতে পারে।"
            })

        media_url = fmt.get("url")
        if not media_url:
            return json.dumps({"ok": False, "error": "Direct media URL পাওয়া যায়নি"})

        headers = {}
        for source in (info.get("http_headers") or {}, fmt.get("http_headers") or {}):
            if isinstance(source, dict):
                for k, v in source.items():
                    if k and v:
                        headers[str(k)] = str(v)
        headers.setdefault("User-Agent", UA)
        headers.setdefault("Referer", url)

        return json.dumps({
            "ok": True,
            "title": _safe_text(info.get("title") or info.get("description") or "video", 120),
            "media_url": media_url,
            "ext": (fmt.get("ext") or info.get("ext") or "mp4"),
            "height": fmt.get("height") or info.get("height") or 0,
            "thumbnail": info.get("thumbnail") or "",
            "headers": headers,
            "webpage_url": info.get("webpage_url") or url,
        })
    except Exception as e:
        msg = _safe_text(e, 240)
        low = (url or "").lower()
        if "facebook.com" in low or "fb.watch" in low or "fb.com" in low:
            fb = _facebook_direct(url, quality)
            if fb.get("ok"):
                return json.dumps(fb)
            if "Cannot parse data" in msg:
                msg = "Facebook extractor বদলেছে; yt-dlp parse করতে পারেনি এবং fallback-ও direct MP4 পায়নি"
        return json.dumps({"ok": False, "error": msg})

def _entry_url(entry):
    if not isinstance(entry, dict):
        return ""
    for key in ("webpage_url", "original_url", "url"):
        v = entry.get(key)
        if v and str(v).startswith(("http://", "https://")):
            return str(v)
    ie = (entry.get("extractor_key") or entry.get("ie_key") or "").lower()
    vid = entry.get("id")
    uploader_id = entry.get("uploader_id") or entry.get("channel_id")
    if "tiktok" in ie and vid and uploader_id:
        return f"https://www.tiktok.com/@{uploader_id}/video/{vid}"
    return ""

def _scan_with_ytdlp(url):
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": "in_playlist",
        "playlistend": 60,
        "http_headers": _headers(url),
        "socket_timeout": 20,
        "retries": 1,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    out = []
    if not info:
        return out

    entries = info.get("entries") or []
    for e in entries:
        if not e:
            continue
        page = _entry_url(e)
        if not page:
            continue
        out.append({
            "url": page,
            "title": _safe_text(e.get("title") or e.get("description") or e.get("id") or "Video", 100),
            "thumbnail": e.get("thumbnail") or "",
        })
        if len(out) >= 60:
            break
    return out

def _fetch_html(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Upgrade-Insecure-Requests": "1",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read(5_000_000)
    return raw.decode("utf-8", "ignore")

def _facebook_profile_candidates(url):
    out = [url]
    m = re.search(r"facebook\.com/([^/?#]+)", url, re.I)
    if m:
        slug = m.group(1)
        if slug.lower() not in ("reel", "watch", "video", "videos", "profile.php"):
            out.extend([
                f"https://www.facebook.com/{slug}/reels/",
                f"https://m.facebook.com/{slug}/reels/",
                f"https://m.facebook.com/{slug}?v=videos",
            ])
    return list(dict.fromkeys(out))

def _scan_html(url):
    low = url.lower()
    pages = [url]
    if "facebook.com" in low or "fb.com" in low:
        pages = _facebook_profile_candidates(url)

    found = []
    seen = set()
    for page in pages:
        try:
            body = _fetch_html(page)
        except Exception:
            continue
        body = htmlmod.unescape(body)

        if "facebook.com" in low or "fb.com" in low:
            ids = []
            ids += re.findall(r"/reel/(\d+)", body)
            ids += re.findall(r"[?&]v=(\d+)", body)
            ids += re.findall(r"/videos/(\d+)", body)
            for vid in ids:
                u = f"https://www.facebook.com/reel/{vid}/"
                if u not in seen:
                    seen.add(u)
                    found.append({"url": u, "title": f"Facebook Reel {len(found)+1}", "thumbnail": ""})
        elif "instagram.com" in low:
            codes = re.findall(r"/(?:reel|reels|p)/([A-Za-z0-9_-]{5,})", body)
            for code in codes:
                u = f"https://www.instagram.com/reel/{code}/"
                if u not in seen:
                    seen.add(u)
                    found.append({"url": u, "title": f"Instagram Reel {len(found)+1}", "thumbnail": ""})
        elif "tiktok.com" in low:
            user = ""
            um = re.search(r"tiktok\.com/@([^/?#]+)", url, re.I)
            if um:
                user = um.group(1)
            ids = re.findall(r"/video/(\d{12,24})", body)
            if user:
                ids += re.findall(r'"id"\s*:\s*"(\d{12,24})"', body)
            for vid in ids:
                u = f"https://www.tiktok.com/@{user}/video/{vid}" if user else f"https://www.tiktok.com/video/{vid}"
                if u not in seen:
                    seen.add(u)
                    found.append({"url": u, "title": f"TikTok Video {len(found)+1}", "thumbnail": ""})

        if len(found) >= 60:
            break
    return found[:60]

def scan_profile(url):
    errors = []
    candidates = [url]
    if "facebook.com" in url.lower() or "fb.com" in url.lower():
        candidates = _facebook_profile_candidates(url)

    for candidate in candidates:
        try:
            entries = _scan_with_ytdlp(candidate)
            if entries:
                return json.dumps({"ok": True, "entries": entries[:60], "source": "yt-dlp"})
        except Exception as e:
            errors.append(_safe_text(e, 140))

    try:
        entries = _scan_html(url)
        if entries:
            return json.dumps({"ok": True, "entries": entries[:60], "source": "public-page"})
    except Exception as e:
        errors.append(_safe_text(e, 140))

    msg = "Public profile থেকে Reel/Video list পাওয়া যায়নি"
    if errors:
        msg += ": " + errors[-1]
    return json.dumps({"ok": False, "error": msg})
