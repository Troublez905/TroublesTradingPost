"""Generate the Toronto edition from the most recent completed UTC spot session."""
import argparse
import datetime as dt
import email.utils
import json
import math
import os
import re
import tempfile
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
UTC = dt.timezone.utc
UNIVERSE = {"BTC": "Bitcoin", "ETH": "Ethereum", "SOL": "Solana", "LINK": "Chainlink", "AVAX": "Avalanche"}
FEEDS = {"CoinDesk": ("https://www.coindesk.com/arc/outboundfeeds/rss/", "coindesk.com"),
         "Cointelegraph": ("https://cointelegraph.com/rss", "cointelegraph.com")}
NFT_STATUS = "No verified collection-level mint, sales or ownership feed was available for this edition."
SOURCE_ERRORS = (ValueError, KeyError, IndexError, TypeError, URLError, OSError, ET.ParseError)


def iso(value):
    return value.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def fetch(url):
    request = Request(url, headers={"User-Agent": "TroublesTradingPost/1.0 (public research desk)"})
    with urlopen(request, timeout=12) as response:
        body = response.read(4_000_001)
    if len(body) > 4_000_000:
        raise ValueError("Source exceeds response limit")
    return body


def market(symbol, start, end, get):
    product = symbol + "-USD"
    params = urlencode({"start": iso(start), "end": iso(end), "granularity": 86400})
    coinbase = f"https://api.exchange.coinbase.com/products/{product}/candles?{params}"
    pair = ("XBT" if symbol == "BTC" else symbol) + "USD"
    kraken = f"https://api.kraken.com/0/public/OHLC?pair={pair}&interval=1440&since={int(start.timestamp())}"
    for venue, url in [("Coinbase Exchange", coinbase), ("Kraken", kraken)]:
        try:
            data = json.loads(get(url))
            if venue == "Kraken":
                if data["error"]:
                    raise ValueError("Venue error")
                rows = next((v for k, v in data["result"].items() if k != "last"), [])
            else:
                rows = data
            row = next((r for r in rows if int(r[0]) == int(start.timestamp())), None)
            if row is None:
                raise ValueError("Completed candle missing")
            indices = (3, 2, 1, 4, 5) if venue == "Coinbase Exchange" else (1, 2, 3, 4, 6)
            opening, high, low, close, volume = [float(row[i]) for i in indices]
            if not all(map(math.isfinite, (opening, high, low, close, volume))) or not (
                    0 < low <= min(opening, close) <= max(opening, close) <= high and volume > 0):
                raise ValueError("Invalid prices or volume")
            change = (close / opening - 1) * 100
            return {"name": f"{UNIVERSE[symbol]} ({symbol})", "chain": None, "stage": None,
                    "narrative": f"{venue} {product} closed at ${close:,.2f}, {change:+.2f}% from its UTC open. "
                                 f"The session traded between ${low:,.2f} and ${high:,.2f} on {volume:,.2f} {symbol} of spot volume.",
                    "footprint": {"accumulation": None, "concentration": None},
                    "watch": f"Compare the next completed daily close with the observed ${low:,.2f} to ${high:,.2f} range.",
                    "source": {"label": f"{venue} {product} daily candle", "url": url},
                    "market": {"venue": venue, "product": product, "open": opening, "high": high, "low": low,
                               "close": close, "baseVolume": volume, "changePct": change,
                               "windowStart": iso(start), "windowEnd": iso(end)}}
        except SOURCE_ERRORS as exc:
            print(f"{symbol} / {venue}: {type(exc).__name__}: {exc}")
    return None


def headlines(now, get):
    entries, failures = {}, []
    for source, (url, domain) in FEEDS.items():
        try:
            rss = ET.fromstring(get(url))
            if rss.find("channel") is None:
                raise ValueError("RSS channel missing")
            for item in rss.findall("./channel/item"):
                title = " ".join((item.findtext("title") or "").split())
                link = (item.findtext("link") or "").strip()
                parsed = urlsplit(link)
                if not title or parsed.scheme != "https" or (parsed.hostname or "").removeprefix("www.") != domain:
                    continue
                try:
                    published = email.utils.parsedate_to_datetime(item.findtext("pubDate") or "")
                except (ValueError, TypeError, OverflowError):
                    continue
                if published.tzinfo and now - dt.timedelta(days=1) <= published <= now:
                    entries[link] = dict(title=title, url=link, source=source, publishedAt=iso(published))
        except SOURCE_ERRORS as exc:
            print(f"{source}: {type(exc).__name__}: {exc}")
            failures.append(source)
    items = sorted(entries.values(), key=lambda x: (x["publishedAt"], x["url"]), reverse=True)[:5]
    status = "Headlines published in the 24 hours before generation." if items else "No verified headlines in the preceding 24 hours."
    if failures:
        status += " Unavailable feeds: " + ", ".join(failures) + "."
    return items, status


def build(now, date, number, get):
    end = dt.datetime.combine(now.date(), dt.time(), UTC)
    start = end - dt.timedelta(days=1)
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {symbol: pool.submit(market, symbol, start, end, get) for symbol in UNIVERSE}
        news_task = pool.submit(headlines, now, get)
        assets = {symbol: task.result() for symbol, task in futures.items()}
        news, news_status = news_task.result()
    tokens = sorted(filter(None, assets.values()), key=lambda x: (-x["market"]["changePct"], x["name"]))
    if not tokens:
        raise RuntimeError("No verified completed market candles. Archive unchanged; retry later.")
    missing = [key for key in UNIVERSE if not assets[key]]
    coverage = f"{len(tokens)} of {len(UNIVERSE)} tracked USD pairs had verified daily candles."
    if missing:
        coverage += " Unavailable: " + ", ".join(missing) + "."
    return {"dateString": f"{date:%A, %B} {date.day}, {date.year}", "editionNumber": f"{number:03d}",
            "kind": "daily", "generatedAt": iso(now), "timezone": "America/Toronto",
            "postPath": f"posts/{date}.md", "tokens": tokens, "nfts": [], "nftStatus": NFT_STATUS,
            "gamePlan": [{"step": "Read the completed session", "desc": f"UTC session {start.date()}. {coverage} "
                          "The watchlist ranks the tracked pairs by open-to-close percentage change."}],
            "watchOut": [{"title": "Coverage and interpretation", "warning": "Each candle represents one USD spot market. "
                          "Wallet attribution, holder concentration, CEX net flows and broader market volume are unavailable."}],
            "news": news, "newsStatus": news_status, "sources": [asset["source"] for asset in tokens]}


def headline_link(item):
    title = re.sub(r"([\\\[\]`*_<>])", r"\\\1", item["title"])
    link = quote(item["url"], safe=":/?&=%#,+;@!~$*'")
    return f"- [{title}]({link}) · {item['source']}, {item['publishedAt']}"


def markdown(edition):
    lines = [f"# Troubles Trading Post | Edition {edition['editionNumber']}", "", edition["dateString"], "",
             f"Generated {edition['generatedAt']} · {edition['timezone']} edition.", "", "## USD spot markets", "",
             edition["gamePlan"][0]["desc"], ""]
    for i, asset in enumerate(edition["tokens"], 1):
        source = asset["source"]
        lines.extend([f"### {i}. {asset['name']}", "", asset["narrative"], "", asset["watch"], "",
                      f"[{source['label']}]({source['url']})", ""])
    lines.extend(["## NFT coverage", "", edition["nftStatus"], "", "## News", "", edition["newsStatus"], ""])
    lines.extend(headline_link(item) for item in edition["news"])
    lines.extend(["", "## Coverage notes", "", edition["watchOut"][0]["warning"], ""])
    return "\n".join(lines)


def write_atomic(path, content):
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=path.parent, delete=False) as file:
        temporary = Path(file.name)
        try:
            file.write(content)
        except OSError:
            file.close()
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def generate(root=ROOT, now=None, get=fetch):
    now = (now or dt.datetime.now(UTC)).astimezone(UTC)
    date = now.astimezone(ZoneInfo("America/Toronto")).date()
    path = root / "data/archive.json"
    archive = json.loads((root / "assets/editions.json").read_text(encoding="utf-8"))
    if path.exists():
        archive.update(json.loads(path.read_text(encoding="utf-8")))
    key = date.isoformat()
    if key not in archive:
        number = max((int(e["editionNumber"]) for e in archive.values()), default=0) + 1
        archive[key] = build(now, date, number, get)
    edition = archive[key]
    write_atomic(path, json.dumps(archive, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
    if edition.get("kind") == "daily":
        write_atomic(root / "posts" / f"{key}.md", markdown(edition))
    print(f"Archive includes {key}, edition {edition['editionNumber']}.")
    return edition


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT, help="Project root")
    generate(parser.parse_args().root)
