import datetime as dt
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_daily_post as post


class DailyPostTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "assets").mkdir()
        (self.root / "assets/editions.json").write_text('{"2026-11-06":{"editionNumber":"088"}}')
        self.now = dt.datetime(2026, 11, 11, 2, tzinfo=dt.timezone.utc)
        self.start = dt.datetime(2026, 11, 10, tzinfo=dt.timezone.utc)

    def fixture(self, url):
        if "coinbase.com" in url:
            return json.dumps([[int(self.start.timestamp()), 90, 120, 100, 110, 10]]).encode()
        if "rss" in url:
            return b"""<rss><channel><item><title>Daily [update]</title><link>https://www.coindesk.com/test</link>
                <pubDate>Tue, 10 Nov 2026 20:00:00 GMT</pubDate></item><item><title>Future</title>
                <link>https://www.coindesk.com/future</link><pubDate>Thu, 12 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>"""
        raise OSError("Unexpected URL")

    def test_toronto_key_complete_utc_session_and_idempotent_repair(self):
        edition = post.generate(self.root, self.now, self.fixture)
        self.assertEqual(edition["postPath"], "posts/2026-11-10.md")
        self.assertEqual(edition["editionNumber"], "089")
        self.assertEqual(edition["tokens"][0]["market"]["windowStart"], "2026-11-10T00:00:00Z")
        self.assertEqual(len(edition["news"]), 1)
        self.assertFalse(edition["nfts"])
        path = self.root / edition["postPath"]
        original = path.read_bytes()
        self.assertIn(b"Daily \\[update\\]", original)
        path.unlink()
        post.generate(self.root, self.now, lambda url: self.fail("Unexpected refetch"))
        self.assertEqual(path.read_bytes(), original)
        archive = json.loads((self.root / "data/archive.json").read_text(encoding="utf-8"))
        self.assertEqual(archive["2026-11-06"], {"editionNumber": "088"})

    def test_fallback_rejects_forming_candle_and_maps_kraken_layout(self):
        def get(url):
            t = int(self.start.timestamp())
            rows = [[t, "100", "120", "90", "110", "104", "30", 15]]
            return json.dumps([[t+86400, 9, 11, 10, 10, 1]] if "coinbase" in url else
                              {"error": [], "result": {"XXBTZUSD": rows, "last": t}}).encode()
        asset = post.market("BTC", self.start, self.start + dt.timedelta(days=1), get)
        self.assertEqual(asset["market"]["venue"], "Kraken")
        self.assertEqual(asset["market"]["baseVolume"], 30)
        self.assertAlmostEqual(asset["market"]["changePct"], 10)

    def test_failure_preserves_archive_and_rejects_unsupported_claims(self):
        path = self.root / "data/archive.json"
        path.parent.mkdir()
        path.write_text("{}")
        with self.assertRaises(RuntimeError):
            post.generate(self.root, self.now, lambda url: b"invalid")
        self.assertEqual(path.read_text(), "{}")
        self.assertFalse((self.root / "posts").exists())
        def partial(url):
            if "BTC-USD" in url:
                return self.fixture(url)
            raise OSError("unavailable")
        edition = post.generate(self.root, self.now, partial)
        self.assertEqual(len(edition["tokens"]), 1)
        self.assertIn("1 of 5", edition["gamePlan"][0]["desc"])
        self.assertIn("Unavailable feeds", edition["newsStatus"])
        self.assertIsNone(edition["tokens"][0]["footprint"]["accumulation"])


if __name__ == "__main__":
    unittest.main()
