"""Process immutable issue-opened events; publish ledger updates with compare-and-swap."""
import base64
import json
import os
import sys
import time
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from engine import SYMBOLS, Rejected, apply_order, parse_order

REPO = os.environ.get("GITHUB_REPOSITORY", "")
BRANCH = "paper-ledger"
LEDGER = "/contents/competition/ledger.json"
INITIAL = {"version":1, "updated":None, "accounts":{}}


def fetch(url, payload=None, method=None, headers=None):
    request = Request(url, data=json.dumps(payload).encode() if payload is not None else None,
                      method=method, headers={"User-Agent":"TroublesTradingPost/1", **(headers or {})})
    with urlopen(request, timeout=12) as response:
        return json.load(response)


def github(path, payload=None, method=None):
    return fetch("https://api.github.com/repos/"+REPO+path, payload, method, {
        "Authorization":"Bearer "+os.environ["GITHUB_TOKEN"], "Accept":"application/vnd.github+json",
        "Content-Type":"application/json", "X-GitHub-Api-Version":"2022-11-28"})


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z","+00:00")).timestamp()


def market_quote(symbol, required=None):
    errors = []
    for venue in ([required] if required else ["Kraken Futures","Deribit"]):
        try:
            if venue == "Kraken Futures":
                market = "PF_"+("XBT" if symbol == "BTC" else symbol)+"USD"
                data = fetch("https://futures.kraken.com/derivatives/api/v3/tickers?nonce="+str(time.time_ns()))
                row = next(r for r in data["tickers"] if r["symbol"] == market and not r["suspended"])
                bid, ask, observed = row["bid"], row["ask"], timestamp(data["serverTime"])
            elif venue == "Deribit":
                market = ("SOL_USDC" if symbol == "SOL" else symbol)+"-PERPETUAL"
                row = fetch("https://www.deribit.com/api/v2/public/ticker?instrument_name="+market+"&nonce="+str(time.time_ns()))["result"]
                if row["instrument_name"] != market or row["state"] != "open":
                    raise ValueError("Market unavailable")
                bid, ask, observed = row["best_bid_price"], row["best_ask_price"], row["timestamp"]/1000
            else:
                raise ValueError("Unknown venue")
            if abs(time.time()-observed) > 90 or not 0 < bid <= ask < 100_000_000:
                raise ValueError("Stale or invalid order book")
            return {"bid":bid, "ask":ask, "venue":venue, "time":int(observed)}
        except (URLError, KeyError, ValueError, TypeError, StopIteration, TimeoutError) as error:
            errors.append(venue+": "+str(error))
    raise RuntimeError("No fresh executable quote. "+"; ".join(errors))


def ensure_branch():
    try:
        github("/git/ref/heads/"+BRANCH)
    except HTTPError as error:
        if error.code != 404:
            raise
        try:
            sha = github("/git/ref/heads/main")["object"]["sha"]
            github("/git/refs",{"ref":"refs/heads/"+BRANCH,"sha":sha})
        except HTTPError as race:
            if race.code != 422:
                raise
            github("/git/ref/heads/"+BRANCH)


def read_state():
    info = github(LEDGER+"?ref="+BRANCH)
    return json.loads(base64.b64decode(info["content"])), info["sha"]


def commit_order(issue):
    order = parse_order(issue["title"])
    for attempt in range(5):
        state, sha = read_state()
        user = issue["user"]
        account = state["accounts"].get(str(user["id"]), {})
        if account.get("lastIssue") == issue["number"]:
            return "This ticket is already recorded in the shared ledger."
        pos = account.get("position")
        venue = pos["venue"] if pos and order[0] == "CLOSE" else None
        quote = market_quote(order[1],venue)
        note = apply_order(state, issue["number"], user["id"], user["login"], order, quote)
        encoded = base64.b64encode(json.dumps(state,separators=(",",":")).encode()).decode()
        try:
            github(LEDGER, {"message":"Record paper ticket #"+str(issue["number"]),
                   "content":encoded, "branch":BRANCH, "sha":sha}, "PUT")
            return note
        except HTTPError as error:
            if error.code != 409 or attempt == 4:
                raise
            time.sleep(1+attempt)
    raise RuntimeError("Ledger contention.")


def main():
    ensure_branch()
    if os.environ["GITHUB_EVENT_NAME"] != "issues":
        state, _ = read_state()
        print("Shared ledger ready. Accounts:", len(state["accounts"]))
        if os.environ.get("QUOTE_TEST") == "true":
            for symbol in SYMBOLS:
                print(symbol, market_quote(symbol))
        return
    with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as event_file:
        event = json.load(event_file)
    issue = event["issue"]
    if event["action"] != "opened" or issue["user"]["type"] != "User" or issue["user"]["id"] != event["sender"]["id"]:
        raise ValueError("Invalid order event identity.")
    failed = False
    try:
        if time.time()-timestamp(issue["created_at"]) > 600:
            raise Rejected("Ticket expired after ten minutes. Submit a new order for a current price.")
        note = commit_order(issue)
    except Rejected as error:
        note = "Paper order rejected. "+str(error)
    except RuntimeError as error:
        note = "Paper order could not be filled. "+str(error)
        failed = True
    path = "/issues/"+str(int(issue["number"]))
    github(path+"/comments", {"body":note})
    github(path, {"state":"closed"}, "PATCH")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
