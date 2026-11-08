"""Refresh the public headline cache using each publisher's RSS feed."""
import json
import sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree

feeds = {
    "CoinDesk": ("https://www.coindesk.com/arc/outboundfeeds/rss/", "coindesk.com"),
    "Decrypt": ("https://decrypt.co/feed", "decrypt.co"),
}


def fetch_items(url, domain):
    request = Request(url, headers={"User-Agent": "TroublesTradingPost/1.0 RSS reader"})
    with urlopen(request, timeout=12) as response:
        root = ElementTree.fromstring(response.read(4_000_000))
    articles = []
    for item in root.findall("./channel/item"):
        title, link = item.findtext("title"), item.findtext("link") or ""
        target = urlsplit(link)
        if target.scheme != "https" or target.hostname not in {domain, "www." + domain} or not title:
            continue
        published = parsedate_to_datetime(item.findtext("pubDate")).astimezone(timezone.utc)
        articles.append(dict(title=title.strip(), url=link, published=published.isoformat()))
        if len(articles) == 4:
            break
    if not articles:
        raise ValueError("No valid articles")
    return articles


if __name__ == "__main__":
    path = Path(sys.argv[1])
    snapshots = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for publisher, (url, domain) in feeds.items():
        try:
            articles = fetch_items(url, domain)
        except (URLError, OSError, ElementTree.ParseError, ValueError, TypeError) as error:
            print(f"{publisher} refresh failed: {error}", file=sys.stderr)
            continue
        snapshots[publisher] = dict(checked=datetime.now(timezone.utc).isoformat(), articles=articles)
    path.write_text(json.dumps(snapshots, indent=2) + "\n", encoding="utf-8")
