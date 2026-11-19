'use strict';
const $ = (id) => document.getElementById(id);
const modeName = {
  single: 'One approved site',
  selected: 'Selected sites',
  open: 'Open browsing'
};
const native =
  window.roomDesktop ||
  (window.RoomMobile && {
    apply: (value) => RoomMobile.postMessage(JSON.stringify(value)),
    finish: () => RoomMobile.postMessage(JSON.stringify({ finish: true }))
  });
let session = JSON.parse(
  sessionStorage.getItem('managedRoom') ||
    localStorage.getItem('managedHost') ||
    'null'
);
let snapshot,
  page = 0,
  timer,
  applied = 0,
  pendingRequest,
  busy = false,
  editRevision;
const notify = (text) => {
  $('notice').textContent = text;
};
function handle(fn) {
  return async (event) => {
    event.preventDefault();
    const button = event.submitter || event.currentTarget;
    button.disabled = true;
    try {
      notify('');
      await fn(event);
    } catch (e) {
      notify(e.message);
    } finally {
      button.disabled = false;
    }
  };
}
function screen(id) {
  for (const key of ['home', 'host', 'participant']) $(key).hidden = key !== id;
}
function save(s) {
  if (s?.host) localStorage.setItem('managedHost', JSON.stringify(s));
  else if (session?.host) localStorage.removeItem('managedHost');
  session = s;
  if (s) sessionStorage.setItem('managedRoom', JSON.stringify(s));
  else sessionStorage.removeItem('managedRoom');
}
async function api(path, method = 'GET', body) {
  const r = await fetch('api/' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + (session?.token || ''),
      'Content-Type': 'application/json'
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });
  if (!r.ok) {
    const err = new Error(
      (await r.json().catch(() => null))?.error || 'Cannot connect to the room.'
    );
    err.status = r.status;
    throw err;
  }
  return r.json();
}
for (const id of ['initialPolicy', 'nextPolicy', 'activityPolicy']) {
  $(id).append($('policy').content.cloneNode(true));
  const mode = $(id).querySelector('select');
  mode.onchange = () => {
    $(id).querySelector('textarea').parentElement.hidden =
      mode.value !== 'selected';
  };
}
function policyData(f) {
  return {
    url: f.get('url'),
    mode: f.get('mode'),
    sites: f.get('sites').trim().split(/\s+/).filter(Boolean)
  };
}
function btn(label, fn) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = handle(fn);
  return b;
}
function row(name, detail) {
  const r = document.createElement('div');
  r.className = 'row';
  const n = document.createElement('b'),
    s = document.createElement('small');
  n.textContent = name;
  s.textContent = detail;
  r.append(n, s);
  return r;
}
function members() {
  const list = snapshot.members.filter((m) =>
    m.name.toLowerCase().includes($('search').value.toLowerCase())
  );
  const pages = Math.max(1, Math.ceil(list.length / 40));
  page = Math.min(page, pages - 1);
  $('roster').replaceChildren(
    ...list
      .slice(page * 40, page * 40 + 40)
      .map((m) =>
        row(
          m.name,
          m.released
            ? 'Released'
            : !m.connected
              ? 'Reconnecting'
              : m.applied === snapshot.revision
                ? 'Policy applied'
                : 'Waiting for policy'
        )
      )
  );
  $('page').textContent = page + 1 + ' / ' + pages;
  $('prev').disabled = !page;
  $('next').disabled = page >= pages - 1;
}
async function review(m, action) {
  let reply;
  if (m.request === 'help') {
    reply = prompt('Reply to ' + m.name + ' (240 characters)');
    if (!reply?.trim()) return;
  }
  await api(session.code + '/review', 'POST', {
    id: m.id,
    request: m.request,
    action,
    reply
  });
  await hostRefresh();
}
async function hostRefresh() {
  snapshot = await api(session.code);
  const ended = snapshot.closed || Date.parse(snapshot.ends_at) <= Date.now();
  $('lifecycle').textContent = ended
    ? 'Ended'
    : Date.parse(snapshot.starts_at) > Date.now()
      ? 'Scheduled'
      : 'Live';
  $('homeBtn').hidden = !ended;
  $('end').hidden = ended;
  $('edit').hidden = ended;
  $('title').textContent = snapshot.title;
  $('invite').textContent =
    'Join code ' +
    session.code +
    ' · Ends ' +
    new Date(snapshot.ends_at).toLocaleString();
  $('current').textContent =
    modeName[snapshot.policy.mode] + ' · ' + snapshot.policy.url;
  $('total').textContent = snapshot.members.length;
  $('online').textContent = ended
    ? 0
    : snapshot.members.filter((m) => m.connected).length;
  const requests = snapshot.members.filter(
    (m) => m.request && !m.released && !ended
  );
  $('count').textContent = requests.length;
  $('queue').replaceChildren(
    ...requests.map((m) => {
      const r = row(
        m.name,
        m.request === 'exit' ? 'Exit requested' : 'Help requested'
      );
      if (m.request === 'exit')
        r.append(btn('Allow exit', () => review(m, 'release')));
      r.append(
        btn(m.request === 'help' ? 'Respond' : 'Decline', () =>
          review(m, 'resolve')
        )
      );
      return r;
    })
  );
  if (!requests.length) $('queue').textContent = 'No pending requests.';
  $('addActivity').hidden = ended;
  $('library').replaceChildren(
    ...snapshot.activities.map((activity) => {
      const r = row(activity.name, modeName[activity.mode]);
      if (!ended)
        r.append(
          btn('Open for everyone', async () => {
            if (
              !confirm(
                'Open ' +
                  activity.name +
                  ' on all participants’ devices? This changes their active page.'
              )
            )
              return;
            await api(session.code + '/policy', 'PUT', {
              ...activity,
              sites: activity.origins,
              revision: snapshot.revision
            });
            await hostRefresh();
          })
        );
      return r;
    })
  );
  members();
  if (ended) clearTimeout(timer);
}
function leave(message) {
  clearTimeout(timer);
  save(null);
  applied = 0;
  pendingRequest = undefined;
  document.body.classList.remove('viewing');
  screen('home');
  notify(message);
}
async function participantSync() {
  const request = pendingRequest;
  const s = await api(session.code + '/sync', 'POST', { applied, request });
  if (request === pendingRequest) pendingRequest = undefined;
  if (
    s.closed ||
    s.released ||
    Date.parse(s.ends_at) <= Date.parse(s.server_time)
  ) {
    await native.finish();
    leave(s.released ? 'The host approved your exit.' : 'This room has ended.');
    return;
  }
  const waiting = Date.parse(s.starts_at) > Date.parse(s.server_time);
  $('sessionTitle').textContent = s.title;
  $('reply').textContent = s.reply || '';
  $('policyInfo').textContent = waiting
    ? 'Starts ' + new Date(s.starts_at).toLocaleString()
    : modeName[s.policy.mode] + ' · ' + new URL(s.policy.url).host;
  $('exit').textContent =
    s.request === 'exit' ? 'Exit requested' : 'Request exit';
  $('help').textContent =
    s.request === 'help' ? 'Help requested' : 'Ask for help';
  if (!waiting && applied !== s.revision) {
    await native.apply({
      ...s.policy,
      revision: s.revision,
      remainingMs: Date.parse(s.ends_at) - Date.parse(s.server_time)
    });
    if (window.roomDesktop) applied = s.revision;
  }
}
window.roomPolicyApplied = (revision) => {
  applied = revision;
};
window.roomExpired = () => leave('This room has ended.');
async function poll() {
  clearTimeout(timer);
  if (!session || busy) return;
  busy = true;
  try {
    if (session.host) await hostRefresh();
    else await participantSync();
  } catch (e) {
    if (e.status === 404 || e.status === 403) {
      if (!session?.host) await native?.finish();
      leave(e.message);
    } else notify(e.message + ' Reconnecting…');
  } finally {
    busy = false;
    if (session && !(session.host && snapshot?.closed))
      timer = setTimeout(poll, 4000 + Math.random() * 2000);
  }
}
function enter() {
  screen(session.host ? 'host' : 'participant');
  document.body.classList.toggle('viewing', !session.host);
  poll();
}
$('join').onsubmit = handle(async (e) => {
  if (!native)
    throw Error('Join from Room on the MySEB desktop or mobile app.');
  const f = new FormData(e.target),
    code = f.get('code').trim().toUpperCase();
  if (!/^RM-[0-9A-F]{12}$/.test(code))
    throw Error('Enter the RM- code from your host.');
  const bytes = crypto.getRandomValues(new Uint8Array(32)),
    token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await api(code + '/join', 'POST', { name: f.get('name'), token });
  save({ code, token, host: false });
  enter();
});
$('create').onsubmit = handle(async (e) => {
  const f = new FormData(e.target);
  const r = await api('', 'POST', {
    title: f.get('title'),
    startsAt: f.get('start') ? new Date(f.get('start')).toISOString() : null,
    minutes: Number(f.get('minutes')),
    ...policyData(f)
  });
  save({ code: r.code, token: r.host, host: true });
  enter();
});
$('edit').onclick = () => {
  const f = $('modify');
  f.hidden = !f.hidden;
  if (f.hidden) return;
  editRevision = snapshot.revision;
  f.elements.url.value = snapshot.policy.url;
  f.elements.mode.value = snapshot.policy.mode;
  f.elements.mode.onchange();
  f.elements.sites.value = snapshot.policy.origins
    .filter((x) => x !== new URL(snapshot.policy.url).origin)
    .join('\n');
};
$('modify').onsubmit = handle(async (e) => {
  if (
    !confirm(
      'Change the allowed sites on all participating devices? This opens the new activity.'
    )
  )
    return;
  await api(session.code + '/policy', 'PUT', {
    ...policyData(new FormData(e.target)),
    revision: editRevision
  });
  e.target.hidden = true;
  await hostRefresh();
});
$('end').onclick = handle(async () => {
  if (confirm('End the room and release all participants?')) {
    await api(session.code + '/end', 'POST');
    await hostRefresh();
  }
});
$('homeBtn').onclick = () => leave('');
$('help').onclick = () => {
  pendingRequest = 'help';
  notify('Sending help request…');
  poll();
};
$('exit').onclick = () => {
  pendingRequest = 'exit';
  notify('Sending exit request…');
  poll();
};
$('search').oninput = () => {
  page = 0;
  members();
};
$('prev').onclick = () => {
  page--;
  members();
};
$('next').onclick = () => {
  page++;
  members();
};
if (!native) {
  $('join').querySelector('button').disabled = true;
  $('nativeNote').textContent =
    'To participate, open Room in the MySEB app. Hosts can use this dashboard in a browser.';
}
if (session && (session.host || native)) enter();
window.addEventListener('room-expired', () => window.roomExpired());
window.addEventListener('room-load-error', () =>
  notify('The activity could not load. Ask the host to check the allowed site.')
);

if (native) document.querySelector('#home nav').hidden = true;

const inviteCode = new URLSearchParams(location.search).get('room');
if (/^RM-[A-F0-9]{12}$/.test(inviteCode || ''))
  $('join').elements.code.value = inviteCode;
$('showQr').onclick = handle(async () => {
  const img = $('qr');
  if (!img.hidden) {
    img.hidden = true;
    return;
  }
  const r = await fetch('api/' + session.code + '/qr', {
    headers: { Authorization: 'Bearer ' + session.token }
  });
  if (!r.ok) throw Error('Cannot load QR code.');
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(await r.blob());
  img.hidden = false;
});
$('export').onclick = () => {
  const cell = (x) => {
    let t = String(x ?? '');
    if (/^[=+@\-\t\r]/.test(t.trimStart())) t = "'" + t;
    return '"' + t.replaceAll('"', '""') + '"';
  };
  const data = [
    [
      'Participant',
      'Last connection',
      'Applied revision',
      'Released',
      'Request'
    ],
    ...snapshot.members.map((m) => [
      m.name,
      m.seen,
      m.applied,
      m.released,
      m.request
    ])
  ];
  const file = URL.createObjectURL(
    new Blob([data.map((r) => r.map(cell).join(',')).join('\r\n')], {
      type: 'text/csv;charset=utf-8'
    })
  );
  const a = document.createElement('a');
  a.href = file;
  a.download = session.code + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(file), 5000);
};

$('addActivity').onsubmit = handle(async (e) => {
  const f = new FormData(e.target);
  await api(session.code + '/activities', 'POST', {
    ...policyData(f),
    name: f.get('name')
  });
  e.target.reset();
  e.target.elements.mode.onchange();
  await hostRefresh();
});
