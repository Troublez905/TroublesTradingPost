(() => {
  "use strict";
  const minute = 60000;

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

  function evaluate(bars, threshold = 0.1) {
    const last = bars.at(-1).close;
    const move = (last / bars[0].open - 1) * 100;
    const average = n => bars.slice(-n).reduce((sum, bar) => sum + bar.close, 0) / n;
    const fast = average(10), slow = average(30);
    const bias = move >= threshold && last > fast && fast > slow ? "Long" :
      move <= -threshold && last < fast && fast < slow ? "Short" : "Neutral";
    return { move, fast, slow, bias };
  }

  const rule = Object.freeze({parseRows, evaluate, version: "momentum-60-v1"});
  if (typeof module !== "undefined" && module.exports) module.exports = rule;
  else window.TTPMomentum = rule;
})();
