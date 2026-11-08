"""Cron entry point. Archive each day's 00:30 Toronto ranking once."""
import json
import os
from datetime import datetime, time, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from zoneinfo import ZoneInfo

from app import initialize, rank_candidates


def archive_if_due(now, directory):
    local = now.astimezone(ZoneInfo("America/Toronto"))
    cutoff = datetime.combine(local.date(), time(0, 30), local.tzinfo)
    if local < cutoff:
        return
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{local.date()}.json"
    if target.exists():
        return
    initialize()
    report = rank_candidates(24, cutoff.astimezone(timezone.utc))
    with NamedTemporaryFile(dir=directory, delete=False, mode="w", encoding="utf-8") as tmp:
        json.dump(report, tmp, indent=2, allow_nan=False)
    try:
        # A hard link publishes the complete file only if no other runner won.
        os.link(tmp.name, target)
    except FileExistsError:
        pass
    finally:
        Path(tmp.name).unlink()


if __name__ == "__main__":
    archive_if_due(datetime.now(timezone.utc), Path(os.getenv("DISPATCH_DIR", "dispatches")))
