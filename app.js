'use strict';
const byId = id => document.getElementById(id);
function element(tag, value, cls) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (cls) node.className = cls;
  return node;
}
const picker = byId('edition');
const copyButton = element('button','Copy full post');
const sendButton = element('button','Simulate 1 AM dispatch');
const actions = element('div','','dispatch-actions');
actions.append(copyButton,sendButton);
const dispatchStatus = element('output','');
dispatchStatus.id = 'dispatch-status';
dispatchStatus.setAttribute('aria-live','polite');
document.querySelector('.sectionhead').append(actions);
document.querySelector('.sectionhead').after(dispatchStatus);
const missing = 'Not reported in this edition.';
function assetFields(asset) {
  const accumulation = asset.footprint?.accumulation || '';
  const concentration = asset.footprint?.concentration || '';
  return [
    ['Chain / mint', asset.chain || asset.mintInfo], ['Launch stage',asset.stage],
    ['Narrative & traction',asset.narrative], ['Smart wallet accumulation',accumulation],
    ['Dollar flows',accumulation.match(/\$[\d,.]+(?:[kmb](?![a-z]))?/ig)?.join(', ')],
    ['CEX flows', accumulation.split(/;|\.\s+/).filter(s => /CEX|exchange (?:inflow|outflow|deposit)/i.test(s)).join('; ').trim()],
    ['Holder concentration',concentration],
    ['Top 10 share', /top (?:ten|10)\b/i.test(concentration) ? concentration.match(/(?:[<>]\s*)?\d+(?:\.\d+)?\s*%/)?.[0] : null],
    ['What to watch',asset.watch]
  ];
}
sendButton.onclick = () => {
  const edition = editions[picker.value];
  if (edition) dispatchStatus.textContent = 'Simulation complete for edition #' + edition.editionNumber +
    ' / 01:00 America/Toronto / cron 0 1 * * *. No email sent.';
};
copyButton.onclick = async () => {
  const edition = editions[picker.value];
  if (!edition) return;
  const body = ['Troubles Trading Post | Sample edition #'+edition.editionNumber,edition.dateString];
  for (const [title, items] of [['Tokens',edition.tokens],['NFTs',edition.nfts]]) {
    body.push('',title);
    items.forEach((item,index) => body.push('',(index+1)+'. '+item.name,...assetFields(item).map(([key,value]) => key + ': ' + (value || missing))));
  }
  body.push('','Morning game plan',...edition.gamePlan.map(i => i.step+'\n'+i.desc),'','What to watch out for',
    ...edition.watchOut.map(i => i.title+'\n'+i.warning),'','Sample research edition. Informational use only.');
  try {
    await navigator.clipboard.writeText(body.join('\n'));
    dispatchStatus.textContent = 'Full dispatch copied.';
  } catch {
    dispatchStatus.textContent = 'Clipboard unavailable. Select and copy the report below.';
    const manual = document.createElement('textarea');
    manual.setAttribute('aria-label','Full dispatch to copy');
    manual.value = body.join('\n');
    dispatchStatus.append(manual);
    manual.focus();
    manual.select();
  }
};
let editions = {};
let category = 'tokens';
function render() {
  dispatchStatus.replaceChildren();
  const edition = editions[picker.value];
  if (!edition) return;
  const rows = edition[category].map((asset, index) => {
    const row = document.createElement('details');
    const title = document.createElement('summary');
    title.append(element('span', String(index + 1).padStart(2,'0'), 'rank'), element('strong',asset.name), element('span',asset.chain || asset.mintInfo,'meta'));
    row.append(title);
    const grid = element('div','','asset-fields');
    for (const [label,value] of assetFields(asset)) {
      const card = element('article','');
      card.append(element('h4',label),element('p',value || missing));
      grid.append(card);
    }
    row.append(grid);
    return row;
  });
  byId('rows').replaceChildren(...rows);
  const notes = [];
  for (const [heading, items] of [['Morning game plan',edition.gamePlan],['What to watch out for',edition.watchOut]]) {
    const panel = document.createElement('details');
    panel.append(element('summary',heading));
    for (const item of items) panel.append(element('h4',item.step || item.title),element('p',item.desc || item.warning));
    notes.push(panel);
  }
  byId('notes').replaceChildren(...notes);
}
function archive() {
  const term = byId('query').value.trim().toLowerCase();
  const matches = Object.keys(editions).sort().reverse().filter(key => {
    const e = editions[key];
    return [key,e.dateString,...e.tokens.map(x=>x.name),...e.nfts.map(x=>x.name)].join(' ').toLowerCase().includes(term);
  });
  byId('matches').replaceChildren(...matches.map(key => {
    const result = element('button',key+'   /   Edition #'+editions[key].editionNumber,'result');
    result.onclick = () => { picker.value = key; picker.onchange(); location.hash = 'dispatch'; };
    return result;
  }));
  if (!matches.length) byId('matches').textContent = 'No matching editions.';
}
function route() {
  const active = ['archive','scanner','futures','paper','leaderboard','resources','lab','monitor'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dispatch';
  for (const link of document.querySelectorAll('nav a')) {
    if (!link.hash || !byId(link.hash.slice(1))) continue;
    const current = link.hash === '#'+active;
    byId(link.hash.slice(1)).hidden = !current;
    if (current) {
      link.setAttribute('aria-current','page');
      document.title = link.textContent.trim() + ' | Troubles Trading Post';
    } else {
      link.removeAttribute('aria-current');
    }
  }
  if (active === 'futures') window.refreshFutures?.();
  if (active === 'paper') window.openPaperDesk?.();
  if (active === 'leaderboard') window.openLeaderboard?.();
  if (active === 'lab') window.openLab?.();
  if (active === 'monitor') window.openMonitor?.();
}
window.addEventListener('hashchange',route);
document.querySelector('.skip').addEventListener('click',event => {
  event.preventDefault();
  byId('workspace').focus();
});
route();
const refreshCandidates = setupScanner();
picker.onchange = () => { render(); refreshCandidates(editions[picker.value]); };
byId('query').oninput = archive;
const buttons = [...byId('tabs').querySelectorAll('button')];
buttons.forEach((button,index) => button.onclick = () => {
  category = index ? 'nfts' : 'tokens';
  buttons.forEach(b=>b.setAttribute('aria-pressed',String(b === button)));
  render();
});
async function load() {
  const response = await fetch('assets/editions.json');
  if (!response.ok) throw Error('Edition request failed');
  editions = await response.json();
  const dates = Object.keys(editions).sort().reverse();
  for (const date of dates) picker.add(new Option(date + (date === dates[0] ? ' / Current edition' : ' / Archive'),date));
  render(); archive(); refreshCandidates(editions[picker.value]);
}
load().catch(() => { byId('rows').textContent = byId('matches').textContent = 'Could not load the dispatch archive. Reload to retry.'; });

// Project a wireframe globe onto the desk's signal grid.
function drawGlobe() {
  const canvas = byId('radar');
  const w = canvas.clientWidth, h = canvas.clientHeight, scale = window.devicePixelRatio || 1;
  canvas.width = w*scale; canvas.height = h*scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale,scale);
  ctx.translate(w*.53,h*.49); ctx.rotate(-.23);
  const r = Math.min(w*.34,h*.39);
  const project = (lat,lon) => {
    const a = lat*Math.PI/180, b = lon*Math.PI/180;
    const z = Math.cos(a)*Math.cos(b), y = Math.sin(a);
    return [r*Math.cos(a)*Math.sin(b),r*(y*.94-z*.342),z*.94+y*.342];
  };
  function curve(points) {
    ctx.beginPath(); let pen = false;
    for (const [x,y,z] of points) {
      if (z < 0) { pen = false; continue; }
      if (pen) ctx.lineTo(x,y); else ctx.moveTo(x,y);
      pen = true;
    }
    ctx.stroke();
  }
  ctx.strokeStyle = '#52dddf'; ctx.lineWidth = .8;
  for (let lat=-80;lat<=80;lat+=10) curve(Array.from({length:181},(_,i)=>project(lat,i*2-180)));
  for (let lon=-180;lon<180;lon+=10) curve(Array.from({length:91},(_,i)=>project(i*2-90,lon)));
  ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();
  ctx.rotate(-.22);ctx.strokeStyle='#c095ff';ctx.beginPath();ctx.ellipse(0,0,r*1.44,r*.4,0,0,Math.PI*2);ctx.stroke();
  for(const angle of [.42,3.68]){ctx.fillStyle='#fff26c';ctx.beginPath();ctx.arc(r*1.44*Math.cos(angle),r*.4*Math.sin(angle),4,0,Math.PI*2);ctx.fill();}
}
new ResizeObserver(drawGlobe).observe(byId('radar'));
