# Troubles Trading Post

[Open the trading desk](https://troublez905.github.io/TroublesTradingPost/) · [Report an issue or suggest a feature](https://github.com/Troublez905/TroublesTradingPost/issues)

A community-editable web app for the Toronto 1 AM crypto and NFT dispatch. The three example editions were imported from the [original Google Site](https://sites.google.com/view/troubles-trading-post). Treat their market descriptions and wallet activity as historical sample copy. The browser edition reads the checked-in archive.

## Run locally

Start a static server in the repository root.

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Visit http://127.0.0.1:8000/. Changes to the HTML, CSS, JavaScript, or edition data appear after a refresh. The optional Python ingestion service has its own [setup guide](backend/README.md).

## Publish on GitHub

Pushes to `main` deploy through the **Publish trading post** GitHub Actions workflow. Maintainers can also rerun it under **Actions**. Forks can enable the workflow by selecting **GitHub Actions** in **Settings > Pages**.

The Pages build includes the interface, archive and Markdown posts. Run the optional webhook service on a Python host with persistent storage if you use it.

### Daily Toronto dispatch

**Troubles Trading Post - Daily 1AM Publish** is scheduled for 1:00 a.m. in `America/Toronto`. GitHub may queue a scheduled run. The publisher uses the Toronto calendar date and retains an existing edition on a repeat run. It writes the archive and dated Markdown to `main`, then explicitly starts **Publish trading post** so the bot's commit reaches Pages. To run it manually, select **Actions → Troubles Trading Post - Daily 1AM Publish → Run workflow** on `main`. The public-data edition runs without API secrets.

## Research tools

**Paper trading** lets you fund a practice account, act on a futures reading or enter a personal idea, then review simulated results. Personal practice history is stored in the current browser. Use the **Leaderboard** for the shared ranked competition. Its order entry, execution timing and account rules are shown on that screen.

**Resources** lists timestamped headlines from CoinDesk and Decrypt and links to research tools. The Pages build refreshes the RSS snapshot on deployment and every three hours on the scheduled workflow. Each source shows its own last successful fetch time.

The **Strategy lab** contains historical candle replay, a directional signal scorecard and walk-forward evaluation. **Calendar & alerts** tracks catalysts and conditional market alerts. The **Paper trading** ticket includes risk sizing, funding, depth scenarios, session limits and trade reviews.

The Ethereum snapshot under **Resources** uses a finalized mainnet block. Set the optional GitHub Actions secret `ALCHEMY_API_KEY` for server-side Alchemy access. PublicNode supplies the fallback. The build publishes only the block metrics, timestamp and provider.

See [the ten feature prompts and their locations](Docs/01-option-advice-for-ttp.md).

Open **Futures** to request a fresh one-hour market snapshot. Each available contract identifies the exchange and observation time. Exchange availability depends on the reader's network and region. Use the chart link to inspect the same instrument.

The header whale radar replays two labeled examples from the webhook demo. The scanner evaluates observations supplied by the reader or a test fixture. The November 6–8, 2026 editions contain imported sample editorial data. For private webhook ingestion and ranking, see the [backend guide](backend/README.md).

## Contribute changes

Open an issue with your proposed feature, evidence for a correction, or feedback on the dispatch. A useful data correction identifies the edition date, the entry, the source and observation time. For an implementation, fork the project, make a branch, and open a pull request against `main`.

Edition data is in [data/archive.json](data/archive.json), keyed by ISO date. Generated editions have a matching Markdown file under [posts](posts/). Keep example entries clearly identified. When submitting research, link public sources, distinguish estimates from observations, and omit personal contacts, webhook signatures and API keys.

Before sending a pull request, start the local server and exercise the changed feature on a narrow and a wide screen. Include screenshots for interface changes and describe what you tested. Review the staged diff for secrets and local database files before pushing.
