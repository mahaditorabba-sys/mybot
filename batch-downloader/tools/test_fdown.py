import re, html, urllib.parse, urllib.request, http.cookiejar

TEST_URL = "https://www.facebook.com/reel/1465997861390846/?app=fbl"

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    "Referer": "https://fdown.net/",
    "Origin": "https://fdown.net",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
body = urllib.parse.urlencode({"URLz": TEST_URL}).encode()
req = urllib.request.Request("https://fdown.net/download.php", data=body, headers=headers)
with opener.open(req, timeout=30) as r:
    page = r.read().decode("utf-8", "replace")
    final = r.geturl()
print("FINAL", final)
print("LEN", len(page))
print("TITLE", re.search(r"<title[^>]*>(.*?)</title>", page, re.I|re.S).group(1)[:120] if re.search(r"<title[^>]*>(.*?)</title>", page, re.I|re.S) else "none")
patterns = [
    ("btn_hd", r'id=["\']btn_download_hd["\'][^>]*href=["\']([^"\']+)'),
    ("btn_sd", r'id=["\']btn_download_sd["\'][^>]*href=["\']([^"\']+)'),
    ("hdlink", r'id=["\']hdlink["\'][^>]*href=["\']([^"\']+)'),
    ("sdlink", r'id=["\']sdlink["\'][^>]*href=["\']([^"\']+)'),
    ("fbcdn", r'href=["\'](https://[^"\']*fbcdn\.net[^"\']*)'),
    ("downloader", r'(https?://fdown\.net/downloader\.php\?id=[^"\'<> ]+|/downloader\.php\?id=[^"\'<> ]+)'),
]
for name, pat in patterns:
    m = re.search(pat, page, re.I)
    print(name, "YES" if m else "NO", html.unescape(m.group(1))[:180] if m else "")
print("HAS_CF", "Just a moment" in page or "cf-chl" in page)
