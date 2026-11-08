(() => {
  'use strict';
  const project = location.hostname.endsWith('.github.io') ?
    location.hostname.split('.')[0] + '/' + (location.pathname.split('/')[1] || 'TroublesTradingPost') :
    'Troublez905/TroublesTradingPost';
  const repository = 'https://github.com/' + project;
  let dialog, ledger, revision = 0;
  function node(tag,text) {
    const el = document.createElement(tag);
    el.textContent = text;
    return el;
  }
  function render() {
    const body = dialog.querySelector('tbody');
    const status = dialog.querySelector('.lb-status');
    body.replaceChildren();
    if (!ledger) return;
    const now = new Date().toISOString();
    const key = now.slice(0,dialog.querySelector('[name=period]').value === 'month' ? 7 : 4);
    const accounts = Object.values(ledger.accounts);
    const ranks = accounts.filter(a=>a.periods[key]?.trades > 0)
      .sort((a,b)=> b.periods[key].pnl-a.periods[key].pnl || a.user.localeCompare(b.user));
    for (const [i,account] of ranks.slice(0,10).entries()) {
      const tr = document.createElement('tr');
      tr.append(node('td',i+1),node('td',account.user),node('td',account.periods[key].trades),
        node('td',new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',signDisplay:'exceptZero'}).format(account.periods[key].pnl)));
      body.append(tr);
    }
    status.textContent = ranks.length ? 'Ranked by realized paper P&L for '+key+' UTC.' :
      'No closed ranked trades for '+key+' UTC. The first settled trade will appear here.';
    const open = accounts.filter(a=>a.position);
    const positions = dialog.querySelector('.lb-positions');
    positions.replaceChildren();
    for (const account of open.sort((a,b)=>a.user.localeCompare(b.user))) {
      const p = account.position;
      positions.append(node('li',account.user+' / '+p.side+' '+p.symbol+' / $'+p.size.toLocaleString('en-US')+
        ' at $'+p.entry.toLocaleString('en-US')+' / '+p.venue));
    }
    if (!open.length) positions.append(node('li','No open ranked positions.'));
  }
  async function refresh() {
    const seq = ++revision;
    const status = dialog.querySelector('.lb-status');
    status.textContent = 'Loading shared ledger...';
    try {
      const r = await fetch('https://api.github.com/repos/'+project+'/contents/competition/ledger.json?ref=paper-ledger',
        {headers:{Accept:'application/vnd.github.raw+json'},cache:'no-store',signal:AbortSignal.timeout(12000)});
      if (!r.ok) throw Error('HTTP '+r.status);
      const next = await r.json();
      if (next.version !== 1 || !next.accounts) throw Error('Invalid ledger');
      if (seq !== revision) return;
      ledger = next;
      render();
    } catch(error) {
      if (seq !== revision) return;
      status.textContent = 'Shared ledger unavailable ('+error.message+'). '+(ledger ? 'Showing the last loaded standings. ' : '')+'Refresh to retry.';
    }
  }
  function mount() {
    dialog = document.getElementById('leaderboard');
    dialog.classList.add('lb-dialog');
    dialog.setAttribute('aria-labelledby','lb-title');
    dialog.innerHTML = `<div class="lb-head"><small>COMMUNITY PAPER EXCHANGE</small></div>
      <h2 id="lb-title">Paper leaderboard</h2>
      <p>Top ten traders by realized paper profit and loss. Every ranked account starts with $10,000.</p>
      <div class="lb-controls"><label>Rankings <select name="period"><option value="month">This month</option><option value="year">This year</option></select></label><button type="button" class="lb-refresh">Refresh standings</button></div>
      <p class="lb-status" role="status"></p>
      <table><thead><tr><th scope="col">Rank</th><th scope="col">Trader</th><th scope="col">Trades</th><th scope="col">P&amp;L</th></tr></thead><tbody></tbody></table>
      <h3>Place a ranked paper order</h3><p>Submit your order as a public GitHub issue. The exchange posts the fill receipt there. Local practice trades stay on your device.</p>
      <form class="lb-order"><label>Action<select name="side"><option>LONG</option><option>SHORT</option><option>CLOSE</option></select></label>
        <label>Market<select name="symbol"><option>BTC</option><option>ETH</option><option>SOL</option></select></label>
        <label>USD size<input name="size" type="number" value="1000" step="1" min="10" max="10000" required></label>
        <button type="submit">Review order on GitHub &#8599;</button></form>
      <details><summary>Open positions</summary><ul class="lb-positions"></ul></details>
      <details><summary>Competition rules</summary><p>One unleveraged position per GitHub account at a time. Open or close at the server's current bid or ask from Kraken Futures, with Deribit as an alternate venue. Close on the opening venue. Both legs incur a 0.05% simulated fee. USD and USDC use parity. Scores count the net P&amp;L of trades closed in each UTC calendar month or year. Open P&amp;L, funding and liquidation are outside this simulation. Ties sort by GitHub username.</p></details>`;
    dialog.querySelector('.lb-refresh').onclick = refresh;
    dialog.querySelector('[name=period]').onchange = render;
    const form = dialog.querySelector('form');
    form.elements.side.onchange = () => {form.elements.size.disabled = form.elements.side.value === 'CLOSE';};
    form.onsubmit = event => {
      event.preventDefault();
      const side = form.elements.side.value;
      const title = '[Paper order] '+side+' '+form.elements.symbol.value+
        (side === 'CLOSE' ? '' : ' '+form.elements.size.valueAsNumber);
      const url = new URL(repository + '/issues/new');
      url.searchParams.set('title',title);
      url.searchParams.set('body','Public simulated order for the Troubles Trading Post community competition. Submit this issue to request a paper fill.');
      window.open(url,'_blank','noopener,noreferrer');
    };
  }
  window.openLeaderboard = () => {
    if (location.hash !== '#leaderboard') { location.hash = 'leaderboard'; return; }
    if (!dialog) mount();
    refresh();
  };
})();
