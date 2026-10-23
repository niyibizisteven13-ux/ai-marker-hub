// Receives one HTML document from the parent page and renders it in place (see sandbox.html).
window.addEventListener('message', function onMessage(event) {
  if (event.source !== window.parent || !event.data || event.data.type !== 'bwenge:render' || typeof event.data.html !== 'string') return;
  window.removeEventListener('message', onMessage);
  document.open();
  document.write(event.data.html);
  document.close();
});
window.parent.postMessage({ type: 'bwenge:sandbox-ready' }, '*');
