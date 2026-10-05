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

def resolve_video(url, quality="Best"):
    try:
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
        return json.dumps({"ok": False, "error": _safe_text(e, 240)})

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
