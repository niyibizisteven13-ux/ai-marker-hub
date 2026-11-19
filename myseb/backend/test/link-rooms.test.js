import test from 'node:test';
import assert from 'node:assert/strict';
import {app} from '../src/server.js';
import {migrate, pool} from '../src/db.js';

test('standalone rooms have separate codes, host controls and activity state', async t => {
  await migrate();
  const server = app.listen(0);
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = (path, method, body, key) => fetch(base + '/liveroom/api/' + path, {
    method, headers:{'Content-Type':'application/json',Authorization:'Bearer ' + (key || '')}, body:JSON.stringify(body),
  });
  const settings = {title:'Workshop',mode:'selected',sites:['https://login.example.org/'],activities:[{title:'Attendance',url:'https://forms.example.org/a'}]};
  assert.equal((await call('', 'POST', {...settings,sites:['file:///tmp/file']})).status,400);
  const {code,key} = await (await call('', 'POST', settings)).json();
  assert.match(code,/^LR-[A-F0-9]{10}$/);
  assert.equal((await call(code)).status,403);
  const member = await (await call(code+'/join','POST',{name:'Alice'})).json();
  const read = async token => (await call(code,'GET',undefined,token)).json();
  assert.equal((await read(member.key)).activity,null);
  assert.equal((await call(code+'/release','POST',{index:0},member.key)).status,403);
  assert.equal((await call(code+'/release','POST',{index:0},key)).status,200);
  const active = await read(member.key);
  assert.deepEqual(active.activity, settings.activities[0]);
  assert.equal(active.members,undefined);
  assert.equal((await call(code+'/opened','POST',{index:0},member.key)).status,200);
  assert.deepEqual((await read(key)).members,[{name:'Alice',opened:0}]);
  assert.equal((await call(code+'/qr','GET',undefined,key)).headers.get('content-type'),'image/png');
  assert.equal((await call(code,'DELETE',undefined,member.key)).status,403);
  assert.equal((await call(code,'DELETE',undefined,key)).status,200);
  assert.equal((await call(code,'GET',undefined,member.key)).status,404);
});
