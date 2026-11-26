import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import JSZip from 'jszip';
import { renderToString } from 'react-dom/server';
import { bizTools } from '../server/services/ai/tools/bizTools.js';
import { createBizService, resetBizLimitsForTests, type Kv } from '../server/services/biz/service.js';
import { memoryMediaStore } from '../server/services/biz/media.js';
import { CATEGORIES, applyProfileData, kindOf, newBusiness, publicView } from '../server/services/biz/model.js';
import { renderShell } from '../server/services/biz/shell.js';
import { KIND_NAV, KIND_PHONE, kindOf as clientKindOf } from '../src/components/biz/kinds.js';
import ProfilePage, { rangeText, sortTimeline } from '../src/components/biz/ProfilePage.js';
import { strength } from '../src/components/biz/ProfileStudio.js';

// Bwenge4profile (a student's or professional's own page) and the different kinds of venture (shop, bookings, school, creator, profile).
const memKv = (): Kv => { const d = new Map<string, unknown>(); return { async get<T>(k: string) { return (d.has(k) ? JSON.parse(JSON.stringify(d.get(k))) : null) as T | null; }, async put(k, v) { d.set(k, JSON.parse(JSON.stringify(v))); }, async del(k) { d.delete(k); } }; };
const make = (paid = false, t = Date.parse('2026-11-17T10:00:00Z')) => { let clock = t; const svc = createBizService({ kv: memKv(), media: memoryMediaStore(), isPaid: async () => paid, now: () => clock }); resetBizLimitsForTests(); return { svc, tick: (ms: number) => { clock += ms; } }; };
const png = (n = 100) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n, 1)]);
const mp4 = (n = 100) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(n, 3)]);

test('the studio kind: the server and the client agree for every category, and each kind has its own menu', () => {
  for (const c of CATEGORIES) assert.equal(clientKindOf(c), kindOf(c), c);
  assert.deepEqual(['shop', 'restaurant', 'farm', 'craft', 'other'].map(kindOf), ['sell', 'sell', 'sell', 'sell', 'sell']);
  assert.deepEqual(['salon', 'health', 'services', 'transport'].map(kindOf), ['book', 'book', 'book', 'book']);
  assert.equal(kindOf('school'), 'learn'); assert.equal(kindOf('creator'), 'creator'); assert.equal(kindOf('profile'), 'profile');
  const ids = (k: keyof typeof KIND_NAV) => KIND_NAV[k].map(([id]) => id);
  // A creator lives on content and brand deals, a profile has no sales, stock or customers, and every menu starts at a home screen and ends at settings.
  assert.ok(ids('creator').indexOf('feed') < ids('creator').indexOf('sales')); assert.ok(!ids('creator').includes('programs'));
  for (const gone of ['sales', 'expenses', 'products', 'customers', 'reports', 'programs', 'trackers', 'secrets']) assert.ok(!ids('profile').includes(gone as never), gone);
  assert.ok(ids('profile').includes('profile')); assert.ok(!ids('sell').includes('profile' as never));
  for (const k of Object.keys(KIND_NAV) as Array<keyof typeof KIND_NAV>) { assert.equal(ids(k)[0], 'dashboard'); assert.equal(ids(k).at(-1), 'settings'); for (const p of KIND_PHONE[k]) assert.ok(ids(k).includes(p), `${k} phone ${p}`); assert.equal(KIND_PHONE[k].length, 4); }
});

test('a profile: clean fields, https links only, a journey with dates in order, nothing from a business page leaks in', async () => {
  const { svc } = make(); const p = await svc.create('stu', { name: 'Aline Uwase', category: 'profile' }); assert.equal(p.category, 'profile'); assert.equal(p.profile, undefined);
  const m = await svc.addMedia('stu', p.id, { name: 'seminar.png', data: png(), scope: 'timeline' }); assert.equal(m.gallery, false); assert.equal((await svc.get('stu', p.id)).coverId, undefined, 'a journey picture is not made the banner');
  const after = await svc.update('stu', p.id, { about: 'I study IT and build mobile apps.', profile: {
    headline: '  IT student · mobile apps  ', school: 'University of Rwanda', skills: 'React, Excel, , React, Public speaking', cvUrl: 'https://drive.google.com/file/d/abc', location: 'Kigali',
    links: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/aline' }, { url: 'github.com/aline' }],
    timeline: [{ kind: 'education', title: 'BSc Information Technology', org: 'University of Rwanda', from: '2022-09', to: 'present' }, { kind: 'event', title: 'Attended Youth Connekt', from: '2024-10-17', to: '', text: 'Met employers.', mediaIds: [m.id, 'not-mine'], url: 'https://youthconnekt.rw' }, { kind: 'weird', title: 'Hackathon', from: '2023-11', to: '2023-11' }, { title: '' }],
  } });
  const pr = after.profile!; assert.equal(pr.headline, 'IT student · mobile apps'); assert.deepEqual(pr.skills, ['React', 'Excel', 'Public speaking']); assert.equal(pr.cvUrl, 'https://drive.google.com/file/d/abc');
  assert.deepEqual(pr.links.map((l) => [l.label, l.url]), [['LinkedIn', 'https://www.linkedin.com/in/aline'], ['github.com', 'https://github.com/aline']]);
  assert.equal(pr.timeline.length, 3, 'an item without a title is dropped'); const ev = pr.timeline.find((t) => t.title.startsWith('Attended'))!;
  assert.equal(ev.from, undefined, 'a full date is not accepted: YYYY or YYYY-MM only'); assert.deepEqual(ev.mediaIds, [m.id], 'only the owner’s own files'); assert.equal(pr.timeline.find((t) => t.title === 'Hackathon')!.kind, 'event', 'an unknown kind becomes an event');
  // a partial change keeps the rest
  const again = await svc.update('stu', p.id, { profile: { headline: 'Final-year IT student' } }); assert.equal(again.profile!.timeline.length, 3); assert.equal(again.profile!.skills.length, 3);
  await assert.rejects(svc.update('stu', p.id, { profile: { links: [{ label: 'Me', url: 'javascript:alert(1)' }] } }), /https/); await assert.rejects(svc.update('stu', p.id, { profile: { cvUrl: 'http://x.rw/cv.pdf' } }), /https/);
  // a business page has no profile data, and a page cannot be switched between business and profile (the allowances are separate)
  const shop = await svc.create('stu', { name: 'Aline Shop', category: 'shop' }); await assert.rejects(svc.update('stu', shop.id, { profile: { headline: 'x' } }), /profile page/);
  await assert.rejects(svc.update('stu', shop.id, { category: 'profile' }), /different pages/); await assert.rejects(svc.update('stu', p.id, { category: 'shop' }), /different pages/); assert.equal((await svc.update('stu', shop.id, { category: 'creator' })).category, 'creator');
});

test('the public face of a profile: what the person chose to show, in order, with no private fields', async () => {
  const { svc } = make(); const p = await svc.create('stu', { name: 'Aline Uwase', category: 'profile', slug: 'aline' });
  const shown = await svc.addMedia('stu', p.id, { name: 'a.png', data: png(), scope: 'timeline' }); const hidden = await svc.addMedia('stu', p.id, { name: 'SECRET.png', data: png(), scope: 'timeline' }); await svc.updateMedia('stu', p.id, hidden.id, { visible: false });
  await svc.update('stu', p.id, { notes: 'PRIVATE NOTE', email: 'aline@example.com', profile: { headline: 'IT student', timeline: [{ kind: 'project', title: 'Farm app', from: '2024', mediaIds: [shown.id, hidden.id] }] } });
  await assert.rejects(svc.setPublished('stu', p.id, true).then(() => null), () => false).catch(() => undefined);
  const pub = (await svc.publicBySlug('aline'))!; assert.equal(pub.profile!.headline, 'IT student'); assert.deepEqual(pub.profile!.timeline[0].media!.map((x) => x.id), [shown.id], 'a hidden file is never public');
  const json = JSON.stringify(pub); for (const leak of ['PRIVATE NOTE', 'SECRET.png', 'mediaIds', 'ownerId', '"stu"']) assert.ok(!json.includes(leak), leak);
  assert.equal(pub.gallery.length, 0, 'journey pictures are not also in the gallery');
  const biz = await svc.create('stu2', { name: 'Cafe', category: 'restaurant' }); assert.equal(publicView(biz).profile, undefined);
  const empty = await svc.create('stu3', { name: 'Empty Person', category: 'profile' }); await assert.rejects(svc.setPublished('stu3', empty.id, true), (e: any) => e.code === 'EMPTY' && /about you/.test(e.message));
});

test('free profile: a few videos are free, a profile does not use the business allowance, a business still needs a paid plan for video', async () => {
  const { svc } = make(false); const p = await svc.create('stu', { name: 'Aline', category: 'profile' }); const shop = await svc.create('stu', { name: 'Aline Shop', category: 'shop' });
  await assert.rejects(svc.create('stu', { name: 'Second', category: 'profile' }), (e: any) => e.code === 'LIMIT' && /profile/.test(e.message)); await assert.rejects(svc.create('stu', { name: 'Another shop', category: 'shop' }), (e: any) => e.code === 'LIMIT');
  for (let i = 0; i < 4; i++) await svc.addMedia('stu', p.id, { name: `v${i}.mp4`, data: mp4(), scope: 'timeline' });
  await assert.rejects(svc.addMedia('stu', p.id, { name: 'v5.mp4', data: mp4() }), (e: any) => e.code === 'LIMIT' && /4 videos/.test(e.message));
  await assert.rejects(svc.addMedia('stu', shop.id, { name: 'v.mp4', data: mp4() }), (e: any) => e.code === 'VIDEO_PAID');
  assert.equal(await svc.uploadCap('stu', p.id), 100 * 1048576, 'free profile video: up to 100 MB'); assert.equal(await svc.uploadCap('stu', shop.id), 6 * 1048576); assert.equal(await svc.uploadCap('stu'), 6 * 1048576);
  await assert.rejects(svc.addMedia('stu', p.id, { name: 'big.mp4', data: Buffer.concat([mp4(), Buffer.alloc(101 * 1048576)]) }), (e: any) => e.code === 'TOO_LARGE' && /100 MB/.test(e.message));
  assert.equal((await make(true).svc.uploadCap('x')) > 100 * 1048576, true);
});

test('the audience numbers behind the creator and profile home: views and taps by day, loves, comments, best posts', async () => {
  const { svc, tick } = make(); const p = await svc.create('cr', { name: 'Kigali Vlogs', category: 'creator', slug: 'kigali-vlogs' }); await svc.update('cr', p.id, { about: 'Vlogs from Kigali' }); await svc.setPublished('cr', p.id, true);
  const a = await svc.addPost('cr', p.id, { text: 'Market day' }); const b = await svc.addPost('cr', p.id, { text: 'Coffee tour' });
  for (let i = 0; i < 3; i++) await svc.publicBySlug('kigali-vlogs', { count: true }); await svc.track('kigali-vlogs', 'whatsapp', 'v1'); await svc.track('kigali-vlogs', 'share', 'v2');
  await svc.like('kigali-vlogs', b.id, 'v1'); await svc.like('kigali-vlogs', b.id, 'v2'); await svc.like('kigali-vlogs', a.id, 'v1'); await svc.addComment('kigali-vlogs', b.id, { name: 'Eric', text: 'Nice!' }, 'v1');
  const d = await svc.dashboard('cr', p.id, 7); const au = d.audience; assert.equal(au.posts, 2); assert.equal(au.likes, 3); assert.equal(au.comments, 1); assert.equal(au.week.views, 3); assert.equal(au.week.whatsapp + au.week.shares, 2);
  assert.equal(au.series.length, 7); assert.equal(au.series.at(-1)!.views, 3); assert.equal(au.series.at(-1)!.taps, 2); assert.equal(au.top[0].text, 'Coffee tour', 'the post people loved and commented on most is first');
  tick(8 * 86_400_000); const later = (await svc.dashboard('cr', p.id, 7)).audience; assert.equal(later.week.views, 0); assert.equal(later.before.views, 3, 'the week before is kept for the comparison');
});

test('link previews for a profile use the /p/ link and the person’s headline', () => {
  const b = newBusiness('1', 'o', 'Aline Uwase', 'aline', 'profile', 'now'); b.profile = { headline: 'IT student <script>', skills: [], timeline: [], links: [], featured: [] }; b.about = 'About me';
  const html = renderShell('<html><head><title>x</title></head><body></body></html>', publicView(b), 'https://www.bwenge.space');
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.bwenge\.space\/p\/aline"/); assert.match(html, /<title>Aline Uwase · IT student &lt;script&gt; · Bwenge4Profile<\/title>/); assert.match(html, /og:type" content="profile"/); assert.ok(!html.includes('<script>'));
  const biz = renderShell('<html><head><title>x</title></head></html>', publicView(newBusiness('2', 'o', 'Cafe', 'cafe', 'restaurant', 'now')), 'https://www.bwenge.space'); assert.match(biz, /\/b\/cafe/);
});

test('the assistant builds a profile by chat: first-person facts only, ids to change them, and never on a business page', async () => {
  resetBizLimitsForTests(); const svc = createBizService({ kv: memKv(), media: memoryMediaStore(), isPaid: async () => false });
  const tools = Object.fromEntries(bizTools(() => svc).map((t) => [t.definition.name, t])); const c: any = { userId: 'stu', files: { async read() { throw new Error('none'); } } };
  assert.match((await tools.biz_create.execute({ name: 'Aline Uwase', category: 'profile', page_name: 'aline' }, c)).text, /\/p\/aline/);
  const set = await tools.biz_profile.execute({ action: 'set', headline: 'IT student', school: 'University of Rwanda', skills: ['React', 'Excel'], open_to: 'Internships', links: [{ label: 'GitHub', url: 'https://github.com/aline' }] }, c); assert.match(set.text, /Updated the profile/); assert.match(set.text, /IT student/);
  assert.match((await tools.biz_profile.execute({ action: 'add_item', kind: 'event', title: 'Attended the AI summit', org: 'Bwenge', from: '2026-03', text: 'Learned how to use AI in class.' }, c)).text, /Added "Attended the AI summit" to the journey \(1 items\)/);
  const got = (await tools.biz_get.execute({}, c)).text; assert.match(got, /Profile: IT student; skills 2; journey items 1: Attended the AI summit \[/); const id = /\[([^\]]+)\]/.exec(got.split('journey items')[1])![1];
  assert.match((await tools.biz_profile.execute({ action: 'change_item', item_id: id, to: '2026-04' }, c)).text, /Changed/); assert.match((await tools.biz_profile.execute({ action: 'remove_item', item_id: 'nope' }, c)).text, /No item/);
  assert.match((await tools.biz_profile.execute({ action: 'add_item' }, c)).text, /title is required/); assert.match((await tools.biz_profile.execute({ action: 'remove_item', item_id: id }, c)).text, /Removed/);
  assert.match((await tools.biz_publish.execute({ on: false }, c)).text, /./);
  const c2: any = { ...c, userId: 'owner' }; await tools.biz_create.execute({ name: 'Mama Cafe', category: 'restaurant' }, c2); assert.match((await tools.biz_profile.execute({ action: 'set', headline: 'x' }, c2)).text, /business page, not a personal profile/);
});

test('the profile page: name, headline, videos first, a journey newest first, skills, links, contact, and a link to share', () => {
  const b: any = { slug: 'aline', name: 'Aline Uwase', category: 'profile', tagline: '', about: 'I study IT.', theme: 'teal', contact: { whatsapp: '250788123456', email: 'aline@example.com' }, hours: [], products: [], gallery: [], updatedAt: 'x', verified: true,
    profile: { headline: 'IT student · mobile apps', school: 'University of Rwanda', location: 'Kigali', openTo: 'Internships', skills: ['React', 'Excel'], links: [{ id: 'l1', label: 'LinkedIn', url: 'https://www.linkedin.com/in/aline' }], cvUrl: 'https://drive.google.com/x', featured: [{ id: 'v1', kind: 'video', video: { state: 'ready', w: 720, h: 1280, duration: 30, poster: true, rev: 1 } }],
      timeline: [{ id: 'a', kind: 'education', title: 'BSc IT', org: 'UR', from: '2022-09', to: 'present' }, { id: 'b', kind: 'event', title: 'Attended Youth Connekt', from: '2024-10' }, { id: 'c', kind: 'award', title: 'Best project', from: '2023', to: '2023' }] } };
  const html = renderToString(React.createElement(ProfilePage, { business: b, mediaSrc: (id: string) => `/m/${id}`, preview: true }));
  for (const s of ['Aline Uwase', 'IT student · mobile apps', 'University of Rwanda', 'Internships', 'Watch me', 'About me', 'Skills', 'React', 'My journey', 'Attended Youth Connekt', 'LinkedIn', 'View CV', 'Get in touch', '/p/aline', 'Bwenge4profile']) assert.ok(html.includes(s), s);
  const [sidebar, main] = html.split('<main');
  assert.match(sidebar, /Read full bio/);
  assert.match(sidebar, /<dialog[^>]+aria-label="About me"/);
  assert.ok(main.indexOf('Watch me') < main.indexOf('About me') && main.indexOf('About me') < main.indexOf('My journey'), 'mobile shows videos, about, then the journey');
  assert.ok(html.indexOf('BSc IT') < html.indexOf('Attended Youth Connekt') && html.indexOf('Attended Youth Connekt') < html.indexOf('Best project'), 'newest first: present, then 2024, then 2023');
  assert.deepEqual(sortTimeline([{ to: '2020' }, { from: '2025' }, { to: 'present', from: '2019' }]).map((x) => JSON.stringify(x)), ['{"to":"present","from":"2019"}', '{"from":"2025"}', '{"to":"2020"}']);
  assert.equal(rangeText({ from: '2022-09', to: 'present' }), 'Sep 2022 – Present'); assert.equal(rangeText({ from: '2023', to: '2023' }), '2023'); assert.equal(rangeText({}), '');
  const bare = renderToString(React.createElement(ProfilePage, { business: { ...b, profile: undefined, contact: {}, about: '' }, mediaSrc: () => '', preview: true })); assert.ok(bare.includes('Aline Uwase') && !bare.includes('My journey') && !bare.includes('Watch me') && !bare.includes('Skills'));
});

test('profile strength tells a student what is missing', () => {
  const b: any = { logoId: undefined, about: '', whatsapp: '', published: false, media: [], profile: undefined }; assert.equal(strength(b).score, 0);
  const full: any = { logoId: 'l', about: 'x'.repeat(80), whatsapp: '250788123456', published: true, media: [{ kind: 'video' }], profile: { headline: 'h', skills: ['a', 'b', 'c'], timeline: [1, 2, 3], links: [1], featured: [] } }; assert.equal(strength(full).score, 100);
  assert.equal(strength({ ...full, published: false }).items.find((i) => !i.ok)!.go, 'dashboard');
});

test('applyProfileData on its own: limits keep a profile small and safe', () => {
  const b = newBusiness('1', 'o', 'A B', 'a-b', 'profile', 'now');
  applyProfileData(b, { skills: Array.from({ length: 50 }, (_, i) => `skill ${i}`), timeline: Array.from({ length: 80 }, (_, i) => ({ title: `Item ${i}`, kind: 'project' })), links: Array.from({ length: 30 }, (_, i) => ({ label: `L${i}`, url: `https://x${i}.rw` })) });
  assert.equal(b.profile!.skills.length, 30); assert.equal(b.profile!.timeline.length, 60); assert.equal(b.profile!.links.length, 12); assert.equal(new Set(b.profile!.timeline.map((t) => t.id)).size, 60, 'every item has its own id');
  assert.deepEqual(applyProfileData(b, null), {}); assert.match(applyProfileData(b, { links: [{ label: 'x', url: 'ftp://x' }] }).error ?? '', /https/);
});

test('profile documents retain original bytes and are served only once the post is public', async () => {
  const { svc } = make();
  const profile = await svc.create('owner', { name: 'Elie', category: 'profile', slug: 'elie-file' });
  await svc.update('owner', profile.id, { about: 'My work' });
  await svc.setPublished('owner', profile.id, true);
  const files = [{ name: 'Certificat été.pdf', data: Buffer.from('%PDF-1.7\nexample\n%%EOF') }];
  for (const [ext, path] of [['docx', 'word/document.xml'], ['xlsx', 'xl/workbook.xml'], ['pptx', 'ppt/presentation.xml']]) {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file(path, '<example/>');
    files.push({ name: `file.${ext}`, data: await zip.generateAsync({ type: 'nodebuffer' }) });
  }
  for (const file of files) {
    const stored = await svc.addMedia('owner', profile.id, { ...file, scope: 'feed' });
    assert.equal(await svc.mediaFor(profile.slug, stored.id), null);
    const post = await svc.addPost('owner', profile.id, { mediaIds: [stored.id] });
    const [publicPost] = await svc.publicPosts(profile.slug, { postId: post.id });
    assert.deepEqual(publicPost.media[0].document, { name: file.name, mime: stored.mime, size: file.data.length });
    const served = await svc.mediaFor(profile.slug, stored.id);
    assert.equal(served?.attachmentName, file.name);
    const { stream } = await served!.open();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), file.data);
    await svc.removePost('owner', profile.id, post.id);
    assert.equal(await svc.mediaFor(profile.slug, stored.id), null);
  }
  assert.equal((await svc.publicBySlug(profile.slug))?.gallery.length, 0);
  await assert.rejects(svc.addMedia('owner', profile.id, { name: 'wrong.docx', data: files[2].data, scope: 'feed' }), { status: 415 });
  await assert.rejects(svc.addMedia('owner', profile.id, { ...files[0], scope: 'timeline' }), { status: 415 });
});
