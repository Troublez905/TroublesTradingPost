(() => {
  'use strict';
  const depth = 500;
  function swap(input, reserveIn, reserveOut) {
    const effective = input * 0.997;
    return reserveOut * effective / (reserveIn + effective);
  }
  function roundTrip(amount, pools) {
    const weth = swap(amount, pools.aUSD, pools.aETH);
    const usdc = swap(weth, pools.bETH, pools.bUSD);
    return {weth, usdc, next: {
      aUSD: pools.aUSD + amount, aETH: pools.aETH - weth,
      bUSD: pools.bUSD - usdc, bETH: pools.bETH + weth
    }};
  }
  function simulate({amount, buy, sell, premium, gas}, second = false) {
    if (![amount,buy,sell].every(n => Number.isFinite(n) && n > 0) ||
        ![premium,gas].every(n => Number.isFinite(n) && n >= 0)) throw Error('Invalid simulation inputs');
    let pools = {aUSD: depth * buy, aETH: depth, bUSD: depth * sell, bETH: depth};
    if (second) pools = roundTrip(amount, pools).next;
    const {weth, usdc} = roundTrip(amount, pools);
    const due = amount * (1 + premium / 10000);
    const reverted = usdc < due;
    return {weth, usdc, due, reverted, net: (reverted ? 0 : usdc - due) - gas};
  }
  if (typeof module === 'object' && module.exports) { module.exports = {simulate}; return; }
  const form = document.getElementById('mev-ticket');
  const fields = form.elements;
  const results = document.getElementById('mev-results');
  const fmt = n => n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  function render(event) {
    event?.preventDefault();
    if (!form.reportValidity()) return;
    const input = Object.fromEntries(['amount','buy','sell','premium','gas'].map(key => [key,fields[key].valueAsNumber]));
    results.replaceChildren();
    const ordering = fields.mode.value === 'order';
    document.getElementById('mev-help').textContent = ordering
      ? 'Compare the same loan before and after another trader completes an equal-sized, self-funded swap on both pools. Each run resets the pools.'
      : 'The bot borrows USDC, buys WETH in pool A, then sells in pool B. Repayment is atomic. If proceeds fall short, the swaps revert and the simulated gas cost is charged.';
    for (const second of ordering ? [false,true] : [false]) {
      const r = simulate(input,second);
      const heading = document.createElement('h3');
      heading.textContent = (ordering ? (second ? 'Second in block' : 'First in block') : 'Flash loan result') +
        ' · ' + (r.reverted ? 'Reverted' : 'Repaid') + ' · ' + fmt(r.net) + ' USDC net';
      const trace = document.createElement('p');
      trace.textContent = 'Quoted swap path: ' + fmt(input.amount) + ' USDC → ' + r.weth.toFixed(6) +
        ' WETH → ' + fmt(r.usdc) + ' USDC. Repayment due ' + fmt(r.due) + ' USDC. Gas ' + fmt(input.gas) + ' USDC.';
      results.append(heading,trace);
    }
  }
  form.onsubmit = render;
  fields.mode.onchange = render;
  fields.preset.onchange = () => {
    fields.buy.value = 2500; fields.sell.value = fields.preset.value === 'flat' ? 2500 : 2600;
    fields.gas.value = fields.preset.value === 'gas' ? 200 : 8;
    fields.amount.value = 5000; fields.premium.value = 5;
    render();
  };
  form.oninput = () => results.replaceChildren();
  render();
})();
