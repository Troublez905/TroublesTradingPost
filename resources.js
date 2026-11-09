(() => {
  const panel = document.getElementById('resources');
  if (!panel) return;
  panel.innerHTML = '<small>RESEARCH LIBRARY</small><h2>News &amp; sources</h2><div class="wire-layout"><section><h3>Market wire</h3><p id="wire-status" role="status">Loading publisher headlines...</p><div id="wire"></div></section><aside><h3>Source directory</h3></aside></div>';
  const directory = [
    ['CoinDesk Markets','Market reporting and exchange coverage.','https://www.coindesk.com/markets'],
    ['Decrypt','Crypto industry reporting and technology news.','https://decrypt.co/news'],
    ['DefiLlama','Compare protocol fees, TVL and derivatives activity.','https://defillama.com/'],
    ['Ethereum documentation','Check how contracts, fees and transactions work.','https://ethereum.org/developers/docs/']
  ];
  function link(title,url) {
    const a = document.createElement('a');
    a.href = url; a.textContent = title; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }
  for (const [name,description,url] of directory) {
    const p = document.createElement('p');
    p.append(link(name,url),document.createElement('br'),description);
    panel.querySelector('aside').append(p);
  }
  const stamp = iso => new Date(iso).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
  const network = document.createElement('section');
  const title = document.createElement('h3');
  title.textContent = 'Ethereum network snapshot';
  const blockInfo = document.createElement('p');
  network.append(title,blockInfo);
  panel.querySelector('aside').append(network);
  async function loadNetwork() {
    const response = await fetch('assets/network.json',{cache:'no-cache'});
    if (!response.ok) throw Error('Snapshot unavailable');
    const block = await response.json();
    blockInfo.append(link('Finalized block '+block.height.toLocaleString(),'https://etherscan.io/block/'+block.height),
      document.createElement('br'),block.transactions+' transactions · '+block.baseFeeGwei.toPrecision(3)+' gwei base fee',
      document.createElement('br'),block.provider+' · block time '+stamp(block.time));
  }
  loadNetwork().catch(()=>{blockInfo.textContent='Block snapshot unavailable.';});
  async function load() {
    const response = await fetch('assets/news.json',{cache:'no-cache'});
    if (!response.ok) throw Error('Headline cache unavailable');
    const data = await response.json();
    const articles = Object.entries(data).flatMap(([source,feed]) =>
      feed.articles.map(article=>({...article,source,checked:feed.checked})));
    articles.sort((a,b)=>Date.parse(b.published)-Date.parse(a.published));
    for (const article of articles) {
      const row = document.createElement('article'), meta = document.createElement('small');
      meta.textContent = article.source+' / '+stamp(article.published);
      row.append(meta,link(article.title,article.url));
      panel.querySelector('#wire').append(row);
    }
    panel.querySelector('#wire-status').textContent = Object.entries(data).map(([name,s])=>name+' checked '+stamp(s.checked)).join(' · ') || 'Headlines unavailable. Visit a publisher in the directory.';
  }
  load().catch(()=>{panel.querySelector('#wire-status').textContent='Headline cache unavailable. Open a publisher in the directory.';});
})();
