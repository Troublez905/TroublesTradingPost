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

The workflow publishes only the static interface and assets. Run the webhook service on a Python host with persistent storage if you use it.

## Research tools

**Paper trading** lets you fund a practice account, act on a futures reading or enter a personal idea, then review simulated results. Personal practice history is stored in the current browser. Use the **Leaderboard** for the shared ranked competition. Its order entry, execution timing and account rules are shown on that screen.

**Resources** lists timestamped headlines from CoinDesk and Decrypt and links to research tools. The Pages build refreshes the RSS snapshot on deployment and every three hours on the scheduled workflow. Each source shows its own last successful fetch time.

See [ten proposed features and their implementation prompts](Docs/01-option-advice-for-ttp.md).

Open **Futures** to request a fresh one-hour market snapshot. Each available contract identifies the exchange and observation time. Exchange availability depends on the reader's network and region. Use the chart link to inspect the same instrument.

The header whale radar replays two labeled examples from the webhook demo. The scanner evaluates observations supplied by the reader or a test fixture. The November editions are sample editorial data. For webhook ingestion, ranking and the scheduled snapshot workflow, see the [backend guide](backend/README.md).

## Contribute changes

Open an issue with your proposed feature, evidence for a correction, or feedback on the dispatch. A useful data correction identifies the edition date, the entry, the source and observation time. For an implementation, fork the project, make a branch, and open a pull request against `main`.

Edition data is in [assets/editions.json](assets/editions.json). Copy an existing edition's structure and use a unique ISO date key. Keep example entries clearly identified. When submitting research, link public sources, distinguish estimates from observations, and omit personal contacts, webhook signatures and API keys.

Before sending a pull request, start the local server and exercise the changed feature on a narrow and a wide screen. Include screenshots for interface changes and describe what you tested. Review the staged diff for secrets and local database files before pushing.
