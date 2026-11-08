# Optional alert service

Run from this directory with Python 3.10 or newer. Install dependencies with
`python -m pip install -r requirements.txt`, set three independent random secrets
in the server environment (`NANSEN_WEBHOOK_SECRET`, `ARKHAM_WEBHOOK_SECRET`,
`ADMIN_API_KEY`), then run `python -m uvicorn app:app --port 8000`. In PowerShell
set each variable with `$env:ADMIN_API_KEY = 'your-generated-value'` and the
corresponding names for the webhook secrets. The default bind address is localhost.
For deployment use an HTTPS host with a persistent writable disk. Set `DB_FILE`
to a private database location. GitHub Pages serves the public frontend only.

Send JSON to `POST /api/webhooks/nansen` or `POST /api/webhooks/arkham`.
Sign the exact body bytes with HMAC-SHA256 using the matching secret. Put the
lowercase hex digest in `X-Nansen-Signature` or `X-Arkham-Signature`. These
are the adapter contracts from the supplied prototype. A provider with a
different webhook format needs a trusted adapter. Exact byte-for-byte retries
are counted once per source. Use a single chain per database.

Example Nansen body:

    {"type":"sm-token-flows","data":{"address":"0xexample","symbol":"DEMO","netflow_usd":12000}}

Example Arkham body:

    {"contract_address":"0xexample","symbol":"DEMO","category":"token","usd_value":3000}

Use a server-side client with `X-Admin-Key` to query
`GET /api/candidates/daily?hours=24`. The top five tokens and NFT collections
rank by signed reported USD amount divided by 10,000 (capped at 100 points),
plus 15 points per distinct reported wallet (capped at 75), multiplied by
1.5 for activity from both sources. Overlapping provider reports can represent
the same transaction. Scores describe alert activity. An editor can query this
endpoint at 12:30 a.m., review the results and prepare the 1 a.m. dispatch.
For signed examples start a server with a disposable DB_FILE and run
`python demo.py` from a second shell with the same environment. It posts three
synthetic alerts to localhost and prints the authenticated daily response.

Run `python dispatch.py` periodically in the backend directory with the same
absolute DB_FILE. It archives a private JSON report under DISPATCH_DIR
(default dispatches/) for the 24 hours ending at 00:30 America/Toronto.
The first run at or after the cutoff writes that day's file. Repeated runs
keep the original. UTC offsets follow Toronto daylight saving time. On a
Linux host, an example crontab entry with explicit paths is

    */5 * * * * cd /srv/trading-post/backend && DB_FILE=/var/lib/trading-post/alerts.db DISPATCH_DIR=/var/lib/trading-post/reports /srv/trading-post/.venv/bin/python dispatch.py

Give the scheduler write permission to the private data directory. On Windows,
Task Scheduler can invoke the same script daily at 00:30 Toronto local time.
Review the dated JSON for the 01:00 dispatch. Posting remains an editorial step.

Run the offline integration test with
`uv run --no-project --with-requirements requirements.txt --with httpx python test_app.py`.
