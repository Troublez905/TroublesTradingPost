'use strict';

function evaluateTrapAudit({cex, volume, proportional, sybil}) {
  // Inputs are observations within the windows and wallet categories labelled in the form.
  return [
    cex === null ? 'Unknown' : cex > 1 ? 'Exclude' : 'Clear',
    volume === null ? 'Unknown' : volume <= 300 ? 'Clear' :
      proportional === '' ? 'Unknown' : proportional === 'no' ? 'Exclude' : 'Clear',
    sybil === null ? 'Unknown' : sybil >= 20 ? 'Flag' : 'Clear'
  ];
}

function setupScanner() {
  const section = document.getElementById('scanner');
  section.innerHTML = `<small>03 &nbsp;/&nbsp; RESEARCH TOOLS</small><h2>Whale trap scanner</h2>
    <p>Screen a contract against the dispatch exclusion rules using your own observations. Results reflect the measurements you enter.</p>
    <button id="open-audit">Open risk scanner</button>
    <dialog id="risk-modal" aria-labelledby="audit-heading">
      <button type="button" id="close-audit" aria-label="Close scanner">Close</button>
      <small>RESEARCH TOOLS</small><h2 id="audit-heading">Three-point audit</h2>
      <p>Enter an EVM or Solana address and the measurements available. Empty fields produce an unknown result.</p>
      <form id="audit-form">
        <label>Candidate <select name="candidate"><option value="">Custom contract</option></select></label>
        <label>Contract or mint address <input name="address" required autocomplete="off" spellcheck="false" placeholder="0x... or Solana mint"></label>
        <label>Circulating supply sent to Binance, Coinbase or Bybit hot wallets within 12 hours of listing or unlock (%)
          <input name="cex" type="number" min="0" max="100" step="any"></label>
        <label>Volume growth over observed period (%) <input name="volume" type="number" min="-100" step="any"></label>
        <label>Did unique active wallets grow proportionally over that same period?
          <select name="proportional"><option value="">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
        <label>Fresh wallets funded by the deployer minutes before liquidity injection
          <input name="sybil" type="number" min="0" step="1"></label>
        <div class="audit-actions"><button type="submit">Run audit</button><button type="button" id="toxic-test">Simulate toxic trap</button></div>
      </form><div id="audit-result" role="status"></div>
    </dialog>`;
  const dialog = section.querySelector('dialog');
  const form = section.querySelector('form');
  const fields = form.elements;
  const result = document.getElementById('audit-result');
  const opener = document.getElementById('open-audit');
  let simulation = false;
  opener.onclick = () => dialog.showModal();
  document.getElementById('close-audit').onclick = () => dialog.close();
  dialog.addEventListener('close', () => opener.focus());
  function clearResult() {
    result.replaceChildren();
    simulation = false;
    fields.address.setCustomValidity('');
  }
  form.oninput = clearResult;
  fields.candidate.onchange = () => {
    const candidate = fields.candidate.value;
    form.reset();
    fields.candidate.value = candidate;
    clearResult();
    if (candidate) fields.address.focus();
  };
  document.getElementById('toxic-test').onclick = () => {
    fields.candidate.value = '';
    fields.address.value = '0x00000000000000000000000000000000deadbeef';
    fields.cex.value = 4.8;
    fields.volume.value = 425;
    fields.proportional.value = 'no';
    fields.sybil.value = 42;
    fields.address.setCustomValidity('');
    simulation = true;
    form.requestSubmit();
  };
  form.onsubmit = event => {
    event.preventDefault();
    const address = fields.address.value.trim();
    if (!/^0x[0-9a-f]{40}$/i.test(address) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      fields.address.setCustomValidity('Enter an EVM address or a base58 Solana mint.');
      fields.address.reportValidity();
      return;
    }
    const measurement = name => fields[name].value === '' ? null : fields[name].valueAsNumber;
    const outcomes = evaluateTrapAudit({cex:measurement('cex'), volume:measurement('volume'),
      proportional:fields.proportional.value, sybil:measurement('sybil')});
    const verdict = outcomes.includes('Exclude') ? 'Excluded' : outcomes.includes('Flag') ? 'Flagged for review' :
      outcomes.includes('Unknown') ? 'Insufficient evidence' : 'No threshold triggered';
    result.replaceChildren(element('h3',(simulation ? 'Simulation' : 'Manual audit') + ' / ' + verdict),
      element('p',(fields.candidate.value || 'Contract') + ' / ' + address));
    ['CEX dump (>1%)', 'Wash trading (>300% without proportional UAW growth)', 'Sybil bundle (20+ wallets)'].forEach((rule,i) =>
      result.append(element('p',rule + ' - ' + outcomes[i])));
  };
  return edition => {
    form.reset();
    fields.candidate.replaceChildren(new Option('Custom contract',''), ...[...edition.tokens,...edition.nfts].map(a => new Option(a.name,a.name)));
    clearResult();
  };
}
