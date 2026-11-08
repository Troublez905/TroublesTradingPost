"""USD paper accounts. Only the Actions worker supplies identity, time and quotes."""
import math
import re
from datetime import datetime, timezone

STARTING_CASH = 10_000
FEE = 0.0005
SYMBOLS = ("BTC", "ETH", "SOL")


class Rejected(ValueError):
    pass


def parse_order(title):
    match = re.fullmatch(r"\[Paper order\] (LONG|SHORT|CLOSE) (BTC|ETH|SOL)(?: ([1-9][0-9]{0,4}))?", title)
    if not match:
        raise Rejected("Use the order form on the leaderboard to create a valid ticket.")
    side, symbol, amount = match.groups()
    if (side == "CLOSE") != (amount is None):
        raise Rejected("An opening order needs a USD size. A close order takes no size.")
    if amount and not 10 <= int(amount) <= STARTING_CASH:
        raise Rejected("Order size must be between $10 and $10,000.")
    return side, symbol, int(amount or 0)


def apply_order(state, ticket, user_id, username, order, quote):
    side, symbol, amount = order
    bid, ask = quote["bid"], quote["ask"]
    if not (0 < bid <= ask and math.isfinite(ask)):
        raise ValueError("Invalid market quote.")
    user = state["accounts"].setdefault(str(user_id), {
        "user": username, "cash": STARTING_CASH, "position": None, "lastIssue": 0,
        "periods": {}, "fills": 0,
    })
    if ticket <= user["lastIssue"]:
        raise Rejected("This ticket was already processed or superseded by a newer ticket.")
    pos = user["position"]
    if side != "CLOSE":
        if pos:
            raise Rejected("Close the existing position before opening another.")
        if amount > user["cash"]:
            raise Rejected("Size exceeds available account equity.")
        price = ask if side == "LONG" else bid
        user["position"] = {"side":side, "symbol":symbol, "size":amount,
                            "entry":price, "opened":quote["time"], "venue":quote["venue"]}
        message = f"Opened {side} {symbol} for ${amount:,.0f} at {price:,.4f}."
    else:
        if not pos or pos["symbol"] != symbol:
            raise Rejected(f"No matching {symbol} position to close.")
        if pos["venue"] != quote["venue"]:
            raise ValueError("Closing quote must come from the opening venue.")
        price = bid if pos["side"] == "LONG" else ask
        quantity = pos["size"] / pos["entry"]
        gross = quantity * (price-pos["entry"]) * (1 if pos["side"] == "LONG" else -1)
        pnl = round(gross - FEE * (pos["size"] + price*quantity), 2)
        user["cash"] = round(user["cash"] + pnl, 2)
        user["position"] = None
        date = datetime.fromtimestamp(quote["time"],timezone.utc).strftime("%Y-%m")
        for key in [date, date[:4]]:
            period = user["periods"].setdefault(key, {"pnl":0, "trades":0})
            period["pnl"] = round(period["pnl"] + pnl, 2)
            period["trades"] += 1
        message = f"Closed {symbol} at {price:,.4f}. Realized P&L including fees: ${pnl:+,.2f}."
    user.update(user=username, lastIssue=ticket, fills=user["fills"]+1)
    state["updated"] = quote["time"]
    return f"{message} Simulated fill from {quote['venue']}."
