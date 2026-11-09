# Ten trading tools for Troubles Trading Post

| Open the tool | Features |
| --- | --- |
| [Paper trading](https://troublez905.github.io/TroublesTradingPost/#paper) | Stop-based sizing, funding calendar, liquidity stress tests, session limits and trade reviews |
| [Strategy lab](https://troublez905.github.io/TroublesTradingPost/#lab) | Blind replay, signal scorecard and walk-forward strategy testing |
| [Calendar and alerts](https://troublez905.github.io/TroublesTradingPost/#monitor) | Sourced catalysts and conditional market alerts |

The original implementation prompts below describe the intended behavior and test cases.

## How to interpret the results

- The paper ticket sizes against a planning stop. The stop and target fields record your plan. Close or reduce the position from the desk to execute an exit.
- The funding calendar reports exchange estimates and the most recent settlement. The paper account's execution model describes its own funding calculation.
- The lab reconstructs one-minute observations from completed historical candles. Compare market, UTC day, horizon, sample size, fees and missing observations before interpreting a score. The archive targets days through two days ago to allow the venue to publish its daily files.
- Alerts sample while the monitor is visible. Calendar entries link to primary sources, show verification times, and can be revised when a release moves.
- The Binance connector confirmed the USD-M mark and funding response. Firecrawl checked the Federal Reserve schedule. The Resources Ethereum snapshot supports an optional server-side Alchemy key and identifies the provider that actually supplied each block.

### 1. Stop-based position sizing

Find the quantity that fits a loss budget before submitting a paper order.

**Build prompt**  
Extend the paper ticket with entry, stop, maximum loss in USDT and estimated exit slippage. For a linear perpetual, size the trade against the entry-to-stop distance plus round-trip fees. Round down to the contract quantity step, enforce available margin and show the estimated loss in both USDT and percent of equity. Test a short, a zero-distance stop and a quantity below the exchange minimum.

### 2. Funding calendar

See the estimated cost of holding a perpetual across its next funding timestamp.

**Build prompt**  
Add a funding calendar using the selected venue's public perpetual feed. Display the contract, funding interval, next settlement in local time and UTC, estimated rate, and the signed cash impact for the current paper position. Distinguish a projected rate from a settled rate. Test negative funding and a change in settlement interval.

### 3. Liquidity stress test

See how execution changes if liquidity disappears before an order reaches the venue.

**Build prompt**  
Extend the paper desk's depth calculation with a scenario panel. Model 25%, 50% and 75% reductions in displayed size, keeping prices fixed. For each scenario show executable quantity, volume-weighted price and slippage in basis points against the original midpoint. Keep the order ticket unchanged while testing scenarios. Verify a buy and a sell that exceed the remaining visible depth.

### 4. Blind candle replay

Practice the same volatile hour more than once without seeing the outcome.

**Build prompt**  
Build a replay session for a selected contract, venue and historical hour. Reveal one candle at a time and allow paper orders using only information visible at that step. Define a conservative fill order when a candle crosses both a stop and a target. Save replay results separately from live practice and ranked results. Test that changing playback speed preserves the fills.

### 5. Signal scorecard

Measure how the futures desk's directional readings perform across all observations, including signals nobody traded.

**Build prompt**  
Record timestamped signals with contract, venue, rule version and the last completed candle. Evaluate returns after 5, 15 and 60 minutes using only subsequent data. Report sample size, median return after fees, win rate and drawdown by direction and symbol. Deduplicate repeated observations and mark missing candles as incomplete. Test the boundary between signal time and the first eligible fill.

### 6. Session loss limits

Practice following a daily risk budget under pressure.

**Build prompt**  
Let a trader configure a session loss limit and maximum gross exposure. Show the amount remaining before each paper order. At the limit, block exposure increases while preserving cancel, reduce and close operations. Define the session timezone and include open losses in the calculation. Test midnight rollover and a losing position carried overnight.

### 7. Catalyst calendar

See scheduled events alongside the contracts they might affect.

**Build prompt**  
Create a calendar of scheduled token unlocks, protocol upgrades and macro releases. Require a primary-source URL, event time, timezone, affected contracts and last verification time. Show estimates distinctly and retain changes when an issuer moves an event. Support symbol and date filters. Test an event postponed across a UTC date boundary.

### 8. Conditional alerts

Follow a setup without continuously watching the screen.

**Build prompt**  
Add opt-in browser alerts for a level crossing, funding threshold or futures bias change. Allow selection of venue, symbol, direction, expiry and cooldown. Publish a trigger only when fresh observations cross the condition, then save its evidence in an alert history. Explain whether monitoring requires an open tab. Test a reconnect and duplicate price updates.

### 9. Trade review notebook

Compare the original thesis with the actual execution and exit.

**Build prompt**  
Attach a thesis, invalidation level, planned exit and setup tag to each paper trade. After closing, preserve the original plan and invite a separate review. Show entry and exit markers, fees, holding time, and R-multiple when initial risk was recorded. Export a CSV with neutralized spreadsheet formulas. Test a scratch trade and an imported trade with no recorded stop.

### 10. Walk-forward strategy lab

Check whether a rule holds up on market periods it was never tuned on.

**Build prompt**  
Build a small walk-forward evaluator for the existing futures rule. Freeze parameters on a training window, then evaluate the subsequent untouched window. Include fees, funding where available, slippage assumptions, sample size and a simple benchmark. Execute after signal formation and record the dataset and parameter versions. Test missing candles, no-trade windows and look-ahead leakage.
