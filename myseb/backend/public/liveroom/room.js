'use strict';
const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);
const native = query.get('client') === 'app';
let session = JSON.parse(sessionStorage.getItem('linkRoom') || 'null');
let state, interval;
function message(t) { $('status').textContent = t; }
function run(fn) { return async event => {
  event?.preventDefault();
  const button = event?.submitter;
  if (button) button.disabled = true;
  try { message(''); await fn(event); } catch (e) { message(e.message); }
  finally { if (button) button.disabled = false; }
}; }
function url(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password) throw Error('Enter an HTTPS link without a username or password.');
  return u.href;
}
function launch(activity, mode, sites) {
  const target = url(activity.url);
  if (native) {
    const link = new URL('launch', location.href);
    link.hash = new URLSearchParams({target,mode,sites:JSON.stringify(sites)});
    location.assign(link.href);
  } else {
    if (mode !== 'open') throw Error('Open LiveRoom in the MySEB app to use this navigation setting.');
    window.open(target, '_blank', 'noopener,noreferrer');
  }
}
function addItem() {
  const row = document.createElement('fieldset');
  row.innerHTML = '<legend>Activity</legend><label>Title<input name="itemTitle" maxlength="120" required></label><label>HTTPS link<input name="itemUrl" type="url" required></label><button type="button">Preview</button> <button type="button">Remove</button>';
  const [preview,remove] = row.querySelectorAll('button');
  preview.onclick = run(() => launch({url:row.querySelector('[name=itemUrl]').value}, $('mode').value, sites()));
  remove.onclick = () => { if ($('items').childElementCount > 1) row.remove(); };
  $('items').append(row);
}
function sites() { return $('mode').value === 'selected' ? $('sites').value.split(/\s+/).filter(Boolean).map(v => new URL(url(v)).origin) : []; }
async function api(path, method='GET', body, key=session?.key) {
  const r = await fetch('api/' + path, {method,headers:{'Content-Type':'application/json',Authorization:'Bearer ' + (key || '')},body:body && JSON.stringify(body)});
  if (!r.ok) throw Error((await r.json().catch(() => null))?.error || 'The request failed.');
  return r.json();
}
function remember(s) { session=s; if(s) sessionStorage.setItem('linkRoom',JSON.stringify(s)); else sessionStorage.removeItem('linkRoom'); }
function leave() {
  clearInterval(interval); remember(null); state=null;
  $('controls').replaceChildren(); $('members').textContent='';
  if ($('qr').src) URL.revokeObjectURL($('qr').src);
  $('sharingHint').hidden=true; $('end').hidden=true; $('qr').hidden=true; $('launch').hidden=true;
  $('room').hidden=true; $('home').hidden=false; message('');
}
async function refresh() {
  const current = session;
  if (!current) return;
  const data = await api(current.code);
  if (session !== current) return;
  state=data;
  $('roomTitle').textContent=data.title;
  $('current').textContent=data.activity ? 'Current activity · ' + data.activity.title : 'Waiting for the host to release an activity.';
  $('launch').hidden=!data.activity;
  $('members').textContent=(data.members || []).map(m => m.name + ' · ' + (m.opened == null ? 'Joined' : 'Opened ' + data.activities[m.opened].title)).join('\n');
}
async function enter() {
  $('home').hidden=true; $('room').hidden=false; $('roomCode').textContent=session.code;
  await refresh();
  if (session.host) {
    $('sharingHint').hidden=false; $('end').hidden=false;
    for (const [index,a] of state.activities.entries()) {
      const button=document.createElement('button'); button.textContent='Release '+a.title;
      button.onclick=run(async () => { await api(session.code+'/release','POST',{index}); await refresh(); });
      $('controls').append(button);
    }
    const r=await fetch('api/'+session.code+'/qr',{headers:{Authorization:'Bearer '+session.key}});
    if(r.ok){ $('qr').src=URL.createObjectURL(await r.blob()); $('qr').hidden=false; }
  }
  interval=setInterval(() => refresh().catch(e => { message(e.message); $('launch').hidden=true; }), 4000);
}
$('launch').onclick=run(async () => {
  const {activity,mode,sites,active}=state;
  launch(activity,mode,sites);
  if (!session.host) await api(session.code+'/opened','POST',{index:active});
});
$('end').onclick=run(async () => { if(confirm('End this room for everyone?')) { await api(session.code,'DELETE'); leave(); } });
$('leave').onclick=leave;
$('mode').onchange=() => { $('sitesLabel').hidden=$('mode').value!=='selected'; };
$('add').onclick=() => { if ($('items').childElementCount < 30) addItem(); };
$('directForm').onsubmit=run(e => launch({url:new FormData(e.target).get('url')},'open',[]));
$('joinForm').onsubmit=run(async e => {
  const code=$('code').value.trim().toUpperCase();
  if(!/^LR-[A-F0-9]{10}$/.test(code)) throw Error('Enter the LR- code shared by your host.');
  const {key}=await api(code+'/join','POST',{name:new FormData(e.target).get('name')});
  remember({code,key,host:false}); await enter();
});
$('createForm').onsubmit=run(async e => {
  const f=new FormData(e.target);
  const activities=f.getAll('itemTitle').map((title,i) => ({title,url:url(f.getAll('itemUrl')[i])}));
  const result=await api('','POST',{title:f.get('title'), mode:$('mode').value,sites:sites(),activities});
  e.target.reset(); remember({...result,host:true}); await enter();
});
addItem();
if(query.get('room')) { $('code').value=query.get('room'); $('join').open=true; }
else $(query.get('view') === 'direct' ? 'direct' : 'join').open=true;
if(session) run(enter)();
