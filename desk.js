'use strict';
const feedTape = document.getElementById('tape');
const feedItems = [...feedTape.children];
for (const item of feedItems) {
  const duplicate = item.cloneNode(true);
  duplicate.setAttribute('aria-hidden','true');
  feedTape.append(duplicate);
}
const feedButton = document.getElementById('pause-feed');
function setFeedPaused(paused) {
  feedTape.style.animationPlayState = paused ? 'paused' : 'running';
  feedButton.textContent = paused ? 'Play' : 'Pause';
  feedButton.setAttribute('aria-label',feedButton.textContent+' whale radar');
}
setFeedPaused(matchMedia('(prefers-reduced-motion: reduce)').matches);
feedButton.onclick = () => setFeedPaused(feedTape.style.animationPlayState !== 'paused');
