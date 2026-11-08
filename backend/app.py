"""Signed alert intake and on-demand editorial candidate rankings."""
import hashlib
import hmac
import json
import math
import os
import sqlite3
from contextlib import asynccontextmanager, closing
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import FastAPI, Header, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool


def connect():
    return sqlite3.connect(os.getenv("DB_FILE", "troubles.db"), timeout=10)


def initialize():
    with closing(connect()) as db, db:
        db.execute("""CREATE TABLE IF NOT EXISTS alerts (
            source TEXT, digest TEXT, contract TEXT, symbol TEXT, category TEXT,
            amount REAL, wallet TEXT, received TEXT, PRIMARY KEY(source, digest)
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS received_idx ON alerts(received)")


@asynccontextmanager
async def lifespan(app):
    await run_in_threadpool(initialize)
    yield


app = FastAPI(title="Troubles Trading Post", lifespan=lifespan)


def secret(name):
    value = os.getenv(name)
    if not value:
        raise HTTPException(503, "Endpoint credentials have not been configured")
    return value.encode()


def address(value):
    return value.lower() if value.startswith(("0x", "0X")) else value


def store(row):
    with closing(connect()) as db, db:
        cursor = db.execute(
            "INSERT INTO alerts VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(source,digest) DO NOTHING",
            row,
        )
        return cursor.rowcount


@app.post("/api/webhooks/{source}")
async def ingest(source: Literal["nansen", "arkham"], request: Request):
    key = secret(source.upper() + "_WEBHOOK_SECRET")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > 262144:
            raise HTTPException(413, "Maximum webhook size is 256 KiB")
        body.extend(chunk)
    signature = request.headers.get(f"X-{source}-Signature", "").encode()
    if not hmac.compare_digest(hmac.new(key, body, hashlib.sha256).hexdigest().encode(), signature):
        raise HTTPException(403, "Invalid webhook signature")
    try:
        payload = json.loads(body)
        if not isinstance(payload, dict):
            raise ValueError
        data = payload.get("data") if source == "nansen" else payload
        if not isinstance(data, dict):
            raise ValueError
        token = data.get("token") or {}
        if not isinstance(token, dict):
            raise ValueError
        contract = data.get("address") or data.get("contract_address") or data.get("token_address") or token.get("address")
        wallet = data.get("wallet_address") or data.get("from_address") or data.get("counterparty")
        symbol = data.get("symbol") or token.get("symbol") or "UNKNOWN"
        category = str(data.get("category") or data.get("asset_type") or "token").lower()
        if "nft" in str(payload.get("type", "")).lower():
            category = "nft"
        fields = ("netflow_usd", "usd_value", "usdValue", "unit_value")
        amount = float(next((data[k] for k in fields if data.get(k) is not None), 0))
        if not isinstance(contract, str) or not contract.strip() or not isinstance(symbol, str):
            raise ValueError
        if category not in {"token", "nft"} or not math.isfinite(amount):
            raise ValueError
        if wallet is not None and not isinstance(wallet, str):
            raise ValueError
    except (ValueError, TypeError, OverflowError, RecursionError) as exc:
        raise HTTPException(422, "Invalid alert payload") from exc
    row = (source, hashlib.sha256(body).hexdigest(), address(contract.strip()), symbol.upper(),
           category, amount, address(wallet) if wallet else None, datetime.now(timezone.utc).isoformat())
    inserted = await run_in_threadpool(store, row)
    return {"status": "success" if inserted else "duplicate", "source": source}


@app.get("/api/candidates/daily")
def daily(hours: int = Query(24, ge=1, le=168), x_admin_key: str = Header("")):
    if not hmac.compare_digest(secret("ADMIN_API_KEY"), x_admin_key.encode()):
        raise HTTPException(401, "Invalid admin key")
    return rank_candidates(hours, datetime.now(timezone.utc))


def rank_candidates(hours, now):
    cutoff = (now - timedelta(hours=hours)).isoformat()
    with closing(connect()) as db:
        rows = db.execute("""SELECT contract, MAX(symbol), category, SUM(amount),
            COUNT(DISTINCT wallet), GROUP_CONCAT(DISTINCT source), COUNT(*)
            FROM alerts WHERE received >= ? AND received < ?
            GROUP BY category, contract ORDER BY contract""", (cutoff, now.isoformat())).fetchall()
    groups = {"token": [], "nft": []}
    for contract, symbol, category, volume, wallets, providers, count in rows:
        sources = sorted(providers.split(","))
        score = min(volume / 10000, 100) + min(wallets * 15, 75)
        groups[category].append(dict(contract_address=contract, symbol=symbol, category=category,
            total_usd_volume=round(volume, 2), unique_whales=wallets, alert_count=count,
            sources=sources, score=round(score * (1.5 if len(sources) > 1 else 1), 2)))
    for items in groups.values():
        items.sort(key=lambda item: -item["score"])
    return dict(generated_at=now.isoformat(), lookback_hours=hours,
                top_5_tokens=groups["token"][:5], top_5_nfts=groups["nft"][:5])
