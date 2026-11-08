# Community paper exchange

The public leaderboard uses GitHub accounts and the repository's Issues and Actions. Each order ticket produces a simulated market fill using a fresh Kraken Futures quote or a Deribit fallback. The Python worker uses the issue author's GitHub numeric ID and immutable issue-opened event. It ignores prices, balances, timestamps and scores in issue descriptions. A position closes on its original venue.

## Enable and check

Push the Pages assets, this directory and `.github/workflows/paper-orders.yml` to the default `main` branch of a public repository. Enable Issues and GitHub Actions. The job needs `contents: write` to create and update the dedicated `paper-ledger` branch and `issues: write` to post receipts and close tickets. Organization restrictions or branch protections must allow those operations. The workflow uses its scoped, ephemeral GitHub token. The main-branch seed contains an empty ledger. The workflow initializes the data branch from main once, then uses compare-and-swap commits on that branch to preserve unrelated orders. Keep direct write access to the ledger restricted to trusted maintainers.

Run **Community paper exchange > Run workflow** with the quote check enabled. This checks that all three markets return usable production quotes without opening a position. On the app, open **Paper leaderboard**, select a size, market and direction, and submit the generated issue on GitHub. Its bot receipt shows the result. Submit a close ticket when finished, then refresh the standings. Order processing depends on the Actions queue. Tickets expire after ten minutes. Refresh the standings to see other browsers' trades.

Accounts begin with $10,000, can hold one unleveraged position, and may open $10 to $10,000 per ticket within their realized balance. Both legs pay a simulated 5 bps fee. Rankings sum whole trades by the UTC date of closure, including fees; they omit unrealized gains, funding and leverage. Public participants can audit fills from individual tickets and ledger commit history. Open positions carry across calendar boundaries. This version keys an account to a GitHub identity and does not establish one account per person.

Run `python -m unittest discover -s competition` from the project root. To inspect a real quote without credentials, run `python -c "import sys; sys.path.insert(0,'competition'); from worker import market_quote; print(market_quote('BTC'))"`.
