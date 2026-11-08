"""Send signed synthetic examples to a local test server only."""
import hashlib
import hmac
import json
import os
from urllib.request import Request, urlopen


def demo(base="http://127.0.0.1:8000"):
    token = {"contract_address": "0x1234567890abcdef1234567890abcdef12345678",
             "symbol": "HYPER", "wallet_address": "0xvc_wallet_arkham", "usd_value": 120000}
    nft = dict(token, category="nft", symbol="ART", contract_address="synthetic-collection")
    nansen = {"name": "Smart Money Inflow", "type": "sm-token-flows",
              "data": {"address": token["contract_address"], "symbol": "HYPER", "asset_type": "token",
                       "wallet_address": "0xwhale111", "netflow_usd": 68500,
                       "labels": ["Smart DEX Trader", "Top 0.1% PnL"]}}
    arkham = dict(token, category="token", event_type="whale_swap",
                  alert_name="Tier-1 VC Early Entry", wallet_labels=["Jump Crypto", "Market Maker"])
    for source, payload in [("nansen", nansen), ("arkham", arkham), ("arkham", nft)]:
        body = json.dumps(payload).encode()
        key = os.environ[source.upper() + "_WEBHOOK_SECRET"].encode()
        signature = hmac.new(key, body, hashlib.sha256).hexdigest()
        headers = {"Content-Type": "application/json", f"X-{source}-Signature": signature}
        with urlopen(Request(base + "/api/webhooks/" + source, body, headers), timeout=5) as response:
            print(response.read().decode())
    with urlopen(Request(base + "/api/candidates/daily", headers={
        "X-Admin-Key": os.environ["ADMIN_API_KEY"]
    }), timeout=5) as response:
        return json.load(response)


if __name__ == "__main__":
    print(json.dumps(demo(), indent=2))
