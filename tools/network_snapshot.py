"""Publish only public Ethereum block fields to the static research desk."""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


def load_block(endpoint):
    body = {"jsonrpc": "2.0", "id": 1, "method": "eth_getBlockByNumber",
            "params": ["finalized", False]}
    request = Request(endpoint, json.dumps(body).encode(),
                      {"Content-Type": "application/json", "User-Agent": "TroublesTradingPost/1.0"})
    with urlopen(request, timeout=10) as response:
        block = json.load(response)["result"]
    return {
        "height": int(block["number"], 16),
        "time": datetime.fromtimestamp(int(block["timestamp"], 16), timezone.utc).isoformat(),
        "baseFeeGwei": int(block["baseFeePerGas"], 16) / 1e9,
        "transactions": len(block["transactions"]),
    }


if __name__ == "__main__":
    providers = [("PublicNode", "https://ethereum-rpc.publicnode.com")]
    key = os.getenv("ALCHEMY_API_KEY")
    if key:
        providers.insert(0, ("Alchemy", "https://eth-mainnet.g.alchemy.com/v2/" + quote(key, safe="")))
    for provider, endpoint in providers:
        try:
            data = load_block(endpoint)
        except (URLError, OSError, KeyError, TypeError, ValueError) as error:
            # Exception URLs can contain a private provider key.
            print(f"{provider} snapshot unavailable ({type(error).__name__}).", file=sys.stderr)
            continue
        data.update(provider=provider, checked=datetime.now(timezone.utc).isoformat())
        Path(sys.argv[1]).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        break
