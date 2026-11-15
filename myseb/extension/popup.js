const $ = (id) => document.getElementById(id);
chrome.storage.local.get(['api', 'name']).then((s) => { $('api').value = s.api || 'http://localhost:4000'; $('name').value = s.name || ''; });
$('go').onclick = async () => {
  $('err').textContent = ''; $('go').disabled = true;
  const r = await chrome.runtime.sendMessage({ type: 'start', code: $('code').value, name: $('name').value, api: $('api').value.trim().replace(/\/+$/, '') });
  $('go').disabled = false;
  if (r?.error) $('err').textContent = r.error; else window.close();
};
