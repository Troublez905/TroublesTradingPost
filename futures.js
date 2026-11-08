(() => {
  "use strict";
  const minute = 60000;
  const markets = ["BTC", "ETH", "SOL"];
  const providers = [
    {
      name: "Binance USD-M",
      endpoint: symbol => "https://fapi.binance.com/fapi/v1/klines?interval=1m&limit=62&symbol=" + symbol,
      rows: data => data,
      chart: symbol => "https://www.binance.com/en/futures/" + symbol
    },
    {
      name: "Bybit Linear",
      endpoint: symbol => "https://api.bybit.com/v5/market/kline?category=linear&interval=1&limit=62&symbol=" + symbol,
      rows: (data, symbol) => data.retCode === 0 && data.result.symbol === symbol && data.result.category === "linear" && data.result.list,
      chart: symbol => "https://www.bybit.com/trade/usdt/" + symbol
    }
  ];
  const price = value => value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const percent = value => (value > 0 ? "+" : "") + value.toFixed(2) + "%";
  const time = value => new Date(value).toISOString().slice(11, 16);
  let generation = 0;
  const active = new Set();
  const results = new Map();
  let interval;

  function parseRows(rows, now) {
    if (!Array.isArray(rows)) throw new Error("Invalid response");
    const bars = rows.map(row => ({ start: Number(row[0]), open: Number(row[1]), close: Number(row[4]) }))
      .sort((a, b) => a.start - b.start);
    const completed = bars.filter(bar => bar.start + minute <= now).slice(-60);
    if (completed.length !== 60 || completed.some((bar, i) =>
      !Number.isInteger(bar.start) || bar.start % minute !== 0 ||
      !Number.isFinite(bar.open) || !Number.isFinite(bar.close) || Math.min(bar.open, bar.close) <= 0 ||
      (i > 0 && bar.start !== completed[i - 1].start + minute))) throw new Error("Incomplete candle history");
    const end = completed[59].start + minute;
    if (now - end >= 2 * minute) throw new Error("Delayed exchange feed");
    const latest = bars.find(bar => bar.start === end && bar.start <= now && Number.isFinite(bar.close) && bar.close > 0);
    return { completed, end, lastPrice: latest?.close ?? completed[59].close, current: Boolean(latest) };
  }

  function study(bars) {
    const last = bars.at(-1).close;
    const move = (last / bars[0].open - 1) * 100;
    const average = n => bars.slice(-n).reduce((sum, bar) => sum + bar.close, 0) / n;
    const fast = average(10), slow = average(30);
    const bias = move >= 0.1 && last > fast && fast > slow ? "Long" :
      move <= -0.1 && last < fast && fast < slow ? "Short" : "Neutral";
    return { move, fast, slow, bias };
  }

  function render(panel, snapshot) {
    const { completed, end, provider, symbol, lastPrice, current } = snapshot;
    const stale = Date.now() - end >= 2 * minute;
    const { move, fast, slow, bias } = study(completed);
    const closes = completed.map(bar => bar.close);
    const low = Math.min(...closes), high = Math.max(...closes);
    const points = closes.map((value, i) => (i * 580 / 59 + 10).toFixed(1) + "," +
      (high === low ? 75 : 139 - 128 * (value - low) / (high - low)).toFixed(1)).join(" ");
    const result = panel.querySelector(".fut-result");
    result.innerHTML = `<div class="fut-chart"><div class="fut-meta"><span>${provider.name} / ${symbol}</span><span>${current ? "Last traded" : "Last close"} (USDT)</span></div>
      <div class="fut-price">${price(lastPrice)}</div>
      <svg viewBox="0 0 600 150" role="img" aria-label="Sixty one-minute closing prices, low ${price(low)}, high ${price(high)} USDT">
      <path d="M10 11H590 M10 75H590 M10 139H590" stroke="currentColor" opacity=".14"/><polyline fill="none" stroke="var(--mint)" stroke-width="2.5" points="${points}"/></svg>
      <div class="fut-meta"><span>${time(end - 60 * minute)} UTC</span><span>${time(end)} UTC</span></div></div>
      <div class="fut-analysis"><small>60-MINUTE RESEARCH BIAS</small><h3>${stale ? "Stale data" : bias}</h3>
      <p>${stale ? "Refresh to calculate a current reading." : "Hour change " + percent(move) + ". Last close " + price(closes[59]) + " USDT. The 10-minute average is " + price(fast) + " and the 30-minute average is " + price(slow) + "."}</p>
      <a href="${provider.chart(symbol)}" target="_blank" rel="noopener noreferrer">Open ${provider.name} chart &#8599;</a></div>`;
  }

  function mount(panel) {
    panel.innerHTML = `<small>PERPETUAL FUTURES</small><h2>Futures desk</h2>
      <div class="fut-controls"><label>Contract <select class="fut-symbol">${markets.map(m => '<option>' + m + 'USDT</option>').join("")}</select></label>
      <button type="button">Refresh all</button></div><p role="status" class="fut-status"></p><div class="fut-comparison" aria-label="Contract comparison"></div><div class="fut-result"></div>
      <details><summary>How the bias is calculated</summary><p>The desk uses 60 completed one-minute candles. Long requires an hour gain of at least 0.10% and a last close above the 10-minute average, with that average above the 30-minute average. Short requires the reverse alignment and a decline of at least 0.10%. All other readings are neutral. This historical momentum rule excludes fees, funding and liquidity.</p></details>`;
    panel.querySelector("select").onchange = () => showComparison(panel);
    panel.querySelector("button").onclick = refresh;
    panel.querySelector(".fut-comparison").onclick = event => {
      const button = event.target.closest("button[data-symbol]");
      if (!button) return;
      panel.querySelector("select").value = button.dataset.symbol;
      showComparison(panel);
      panel.querySelector('[data-symbol="' + button.dataset.symbol + '"]').focus();
    };
  }

  function startTimer(panel) {
    interval = setInterval(() => {
      if (panel.hidden || document.hidden || !panel.isConnected) {
        clearInterval(interval);
        interval = null;
        return;
      }
      refresh();
    }, minute);
  }

  function showComparison(panel) {
    const selected = panel.querySelector("select").value;
    const summary = panel.querySelector(".fut-comparison");
    summary.innerHTML = markets.map(market => {
      const symbol = market + "USDT";
      const entry = results.get(symbol);
      const fresh = entry?.completed && Date.now() - entry.end < 2 * minute;
      const stats = fresh ? study(entry.completed) : null;
      const label = stats?.bias || (entry?.error ? "Unavailable" : entry ? "Stale" : "Loading");
      const meta = stats ? percent(stats.move) + " / " + entry.provider.name : "";
      return `<button type="button" data-symbol="${symbol}" data-bias="${label}" aria-pressed="${selected === symbol}"><strong>${symbol}</strong><span>${label}</span><small>${meta}</small></button>`;
    }).join("");
    const chosen = results.get(selected);
    if (chosen?.completed) render(panel, chosen);
    else panel.querySelector(".fut-result").textContent = chosen?.error || "Loading contract chart...";
    const count = [...results.values()].filter(entry => entry.completed).length;
    panel.querySelector(".fut-status").textContent = results.size < markets.length
      ? "Checking BTC, ETH and SOL perpetuals..."
      : count + " of " + markets.length + " contracts available. Updates every minute.";
    if (chosen?.completed) {
      panel.querySelector(".fut-status").textContent += " " + selected + " through " +
        new Date(chosen.end).toISOString().slice(0, 19).replace("T", " ") + " UTC.";
    }
  }

  async function loadContract(symbol, id) {
    const errors = [];
    for (const provider of providers) {
      const controller = new AbortController();
      active.add(controller);
      const timeout = setTimeout(() => controller.abort(), 6500);
      try {
        const response = await fetch(provider.endpoint(symbol), { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();
        const next = parseRows(provider.rows(data, symbol), Date.now());
        if (generation !== id) return;
        return { ...next, provider, symbol };
      } catch (error) {
        if (generation !== id) return;
        errors.push(provider.name + " (" + (error.name === "AbortError" ? "timeout" : error.message) + ")");
      } finally {
        clearTimeout(timeout);
        active.delete(controller);
      }
    }
    return { error: "Market data unavailable. " + errors.join(", ") + ". Try refreshing later." };
  }

  async function refresh() {
    const panel = document.getElementById("futures");
    if (!panel) return;
    if (!panel.querySelector(".fut-symbol")) mount(panel);
    if (!interval) startTimer(panel);
    const id = ++generation;
    for (const controller of active) controller.abort();
    results.clear();
    showComparison(panel);
    await Promise.all(markets.map(async market => {
      const symbol = market + "USDT";
      const entry = await loadContract(symbol, id);
      if (generation !== id) return;
      results.set(symbol, entry);
      showComparison(panel);
    }));
  }
  document.addEventListener("visibilitychange", () => {
    const panel = document.getElementById("futures");
    if (!document.hidden && panel && !panel.hidden) refresh();
  });
  window.refreshFutures = refresh;
})();
