import hashlib
import hmac
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from app import app
from dispatch import archive_if_due


class DispatchTest(unittest.TestCase):
    def test_archive_observes_toronto_cutoff_and_deduplicates(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
            "DB_FILE": os.path.join(folder, "test.db")
        }):
            output = Path(folder) / "reports"
            for month, hour in [(1, 5), (7, 4)]:
                before = datetime(2026, month, 10, hour, 29, tzinfo=timezone.utc)
                path = output / f"2026-{month:02}-10.json"
                archive_if_due(before, output)
                self.assertFalse(path.exists())
                archive_if_due(before.replace(minute=35), output)
                self.assertEqual(json.loads(path.read_text())["generated_at"],
                                 before.replace(minute=30).isoformat())
                stamp = path.stat().st_mtime_ns
                archive_if_due(before.replace(minute=40), output)
                self.assertEqual(path.stat().st_mtime_ns, stamp)

    def test_ingestion_auth_retry_and_ranking(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
            "DB_FILE": os.path.join(folder, "test.db"), "NANSEN_WEBHOOK_SECRET": "test",
            "ARKHAM_WEBHOOK_SECRET": "test", "ADMIN_API_KEY": "test-admin",
        }), TestClient(app) as client:
            alert = {"contract_address": "0xDemo", "symbol": "DEMO", "usd_value": 10000}
            for source, payload in [("nansen", {"data": alert}), ("arkham", alert)]:
                path = "/api/webhooks/" + source
                body = json.dumps(payload).encode()
                self.assertEqual(client.post(path, content=body).status_code, 403)
                signature = hmac.new(b"test", body, hashlib.sha256).hexdigest()
                for expected in ("success", "duplicate"):
                    response = client.post(path, content=body, headers={"X-" + source + "-Signature": signature})
                    self.assertEqual(response.json()["status"], expected)
            path = "/api/candidates/daily"
            self.assertEqual(client.get(path).status_code, 401)
            report = client.get(path, headers={"X-Admin-Key": "test-admin"}).json()
            token, = report["top_5_tokens"]
            self.assertEqual((token["score"], token["alert_count"], token["unique_whales"]), (3, 2, 0))
            self.assertEqual(report["top_5_nfts"], [])


if __name__ == "__main__":
    unittest.main()
