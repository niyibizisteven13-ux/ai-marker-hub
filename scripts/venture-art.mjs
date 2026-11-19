// Draws the brand art for the 4biz venture page: the Bwenge logo, a banner and one picture for each product.
// Run once when the design changes, then commit the images it writes to server/assets/venture:
//   node scripts/venture-art.mjs          (needs Playwright with Chromium and the Inter font installed; sharp is already a dependency)
// The server only uploads the finished files, so it never needs a browser or fonts.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');   // Playwright is a tool for this script, not a dependency of the app
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'server/assets/venture'); mkdirSync(out, { recursive: true });
const logoSvg = resolve(root, 'public/logo/bwenge-icon.svg'); const logoUrl = pathToFileURL(logoSvg).href;

const css = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--navy:#0B1420;--deep:#070D16;--gold:#F6B94A;--gold2:#E08C1E;--teal:#4CE5D6;--teal2:#1FB3A6;--text:#EAF0FA;--muted:#9AA9C4;--line:rgba(255,255,255,.12)}
body{font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:var(--text);background:var(--deep);-webkit-font-smoothing:antialiased;overflow:hidden}
.stage{position:relative;overflow:hidden;background:
  radial-gradient(900px 500px at 12% -10%,rgba(246,185,74,.22),transparent 60%),
  radial-gradient(900px 560px at 92% 110%,rgba(76,229,214,.20),transparent 60%),
  linear-gradient(135deg,#0B1420 0%,#0E2233 55%,#0B1420 100%)}
.stage:before{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.10) 1.2px,transparent 1.2px);background-size:34px 34px;mask-image:radial-gradient(ellipse at center,#000 30%,transparent 75%)}
.glass{background:linear-gradient(160deg,rgba(255,255,255,.10),rgba(255,255,255,.03));border:1px solid var(--line);border-radius:32px;box-shadow:0 30px 60px -20px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.12)}
.gold{background:linear-gradient(135deg,var(--gold),var(--gold2));-webkit-background-clip:text;background-clip:text;color:transparent}
.pill{display:inline-flex;align-items:center;gap:10px;border:1px solid var(--line);background:rgba(255,255,255,.06);border-radius:999px;padding:10px 22px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:20px;color:var(--text)}
svg{display:block}
`;

const icon = {
  shield: (s = 64, c = '#4CE5D6') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/><path d="M8.7 12.2l2.3 2.3 4.4-4.6"/></svg>`,
  spark: (s = 64, c = '#F6B94A') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${c}"><path d="M12 2l2.2 6.3L20.5 10l-6.3 1.7L12 18l-2.2-6.3L3.5 10l6.3-1.7L12 2z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" opacity=".7"/></svg>`,
  store: (s = 64, c = '#EAF0FA') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9"/><path d="M3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0"/><path d="M5 12v8h14v-8"/><path d="M10 20v-5h4v5"/></svg>`,
  check: (s = 40) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M12 1.8l2.6 1.9 3.2-.1 1 3 2.6 1.9-1 3 1 3-2.6 1.9-1 3-3.2-.1L12 22.2l-2.6-1.9-3.2.1-1-3-2.6-1.9 1-3-1-3 2.6-1.9 1-3 3.2.1L12 1.8z" fill="#1D9BF0"/><path d="M8.2 12.2l2.5 2.5 5-5.2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

// The page puts its own logo, name and buttons over the lower-left of the banner, and a phone shows only the middle of it. So the wordmark and the aim sit in the top centre,
// the product cards sit high and well inside the edges, and the page's logo is not repeated here.
const banner = () => `<style>${css}
.stage{width:2400px;height:600px}
.center{position:absolute;left:50%;top:78px;transform:translateX(-50%);text-align:center;display:flex;flex-direction:column;align-items:center}
.word{font-size:190px;font-weight:900;letter-spacing:-7px;line-height:1}
.tag{font-size:40px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--teal);margin-top:10px}
.rule{width:150px;height:6px;border-radius:6px;margin-top:20px;background:linear-gradient(90deg,var(--gold),var(--gold2))}
.cluster{position:absolute;top:62px;display:flex;flex-direction:column;gap:24px}
.card{width:440px;padding:22px 28px;display:flex;align-items:center;gap:22px}
.card b{display:block;font-size:34px;font-weight:800}.card span{font-size:21px;color:var(--muted);font-weight:500}
.ico{width:80px;height:80px;border-radius:24px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.07);border:1px solid var(--line);flex:none}
.l{left:230px}.r{right:230px}
.l .card:nth-child(2){margin-left:50px}.r .card:nth-child(2){margin-right:50px}
.line{position:absolute;left:0;right:0;bottom:0;height:8px;background:linear-gradient(90deg,var(--gold),var(--teal))}
</style>
<div class="stage">
  <div class="cluster l">
    <div class="glass card"><div class="ico">${icon.shield(44)}</div><div><b>MySEB</b><span>Secure online exams</span></div></div>
    <div class="glass card"><div class="ico">${icon.spark(44)}</div><div><b>Bwenge AI</b><span>Study and work assistant</span></div></div>
  </div>
  <div class="cluster r">
    <div class="glass card"><div class="ico">${icon.store(44)}</div><div><b>Bwenge4biz</b><span>Pages, records, growth</span></div></div>
    <div class="glass card"><div class="ico"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#4CE5D6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="M6 20v-6M11 20V8M16 20v-9M21 20V4"/></svg></div><div><b>Growth</b><span>Records that guide you</span></div></div>
  </div>
  <div class="center">
    <div class="word"><span class="gold">4</span>biz</div>
    <div class="rule"></div>
    <div class="tag">AI in our context</div>
  </div>
  <div class="line"></div>
</div>`;

const shell = (accent, label, body) => `<style>${css}
.stage{width:1200px;height:900px}
.label{position:absolute;left:56px;top:50px;display:flex;align-items:center;gap:16px}
.label img{width:64px;height:64px;border-radius:18px;box-shadow:0 0 0 1px rgba(255,255,255,.12)}
.label b{font-size:38px;font-weight:800;letter-spacing:-.5px}
.win{position:absolute;border-radius:30px;overflow:hidden;background:#101C2C;border:1px solid var(--line);box-shadow:0 40px 80px -24px rgba(0,0,0,.7)}
.bar{height:62px;background:#0D1827;display:flex;align-items:center;gap:10px;padding:0 24px;border-bottom:1px solid var(--line)}
.dot{width:14px;height:14px;border-radius:50%}
.t{margin-left:14px;font-weight:700;font-size:22px}
.glow{position:absolute;width:640px;height:640px;border-radius:50%;filter:blur(80px);opacity:.30;background:${accent}}
.bars span{display:block;height:14px;border-radius:7px;background:rgba(255,255,255,.14);margin-bottom:14px}
</style>
<div class="stage"><div class="glow" style="right:-140px;bottom:-200px"></div>
<div class="label"><img src="${logoUrl}"/><b>${label}</b></div>${body}</div>`;

const myseb = () => shell('#1FB3A6', 'MySEB', `
<div class="win" style="left:150px;top:170px;width:900px;height:500px">
  <div class="bar"><i class="dot" style="background:#FF6B6B"></i><i class="dot" style="background:#F6B94A"></i><i class="dot" style="background:#4CE5D6"></i><span class="t">Live room</span>
    <span style="margin-left:auto;display:flex;gap:12px"><span class="pill" style="padding:6px 16px;font-size:16px;color:#4CE5D6;border-color:rgba(76,229,214,.4)">Secure</span><span class="pill" style="padding:6px 16px;font-size:16px;letter-spacing:.06em">42:10</span></span></div>
  <div style="padding:30px;display:grid;grid-template-columns:repeat(4,1fr);gap:18px">
    ${Array.from({ length: 8 }, (_, i) => { const flag = i === 5; const c = flag ? '#F6B94A' : '#4CE5D6'; return `<div style="aspect-ratio:4/3;border-radius:18px;background:${flag ? 'rgba(246,185,74,.12)' : 'rgba(255,255,255,.06)'};border:1px solid ${flag ? 'rgba(246,185,74,.55)' : 'var(--line)'};position:relative;padding:16px"><div style="width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.16)"></div><div style="margin-top:14px;width:70%;height:10px;border-radius:5px;background:rgba(255,255,255,.16)"></div><i style="position:absolute;right:14px;top:14px;width:14px;height:14px;border-radius:50%;background:${c};box-shadow:0 0 12px ${c}"></i></div>`; }).join('')}
  </div>
</div>
<div class="glass" style="position:absolute;right:150px;bottom:60px;padding:26px 30px;display:flex;align-items:center;gap:20px;border-radius:28px;background:linear-gradient(160deg,#143246,#0E2233)">${icon.shield(70)}<div><div style="font-size:30px;font-weight:800">Exam secured</div><div style="font-size:20px;color:var(--muted)">Checks run while students write</div></div></div>`);

const ai = () => shell('#E08C1E', 'Bwenge AI', `
<div class="win" style="left:150px;top:170px;width:900px;height:560px">
  <div class="bar"><i class="dot" style="background:#FF6B6B"></i><i class="dot" style="background:#F6B94A"></i><i class="dot" style="background:#4CE5D6"></i><span class="t">Bwenge AI</span>
    <span style="margin-left:auto;display:flex;gap:10px"><span class="pill" style="padding:6px 16px;font-size:16px;background:linear-gradient(135deg,#F6B94A,#E08C1E);color:#0B1420;border:none">EN</span><span class="pill" style="padding:6px 16px;font-size:16px">RW</span></span></div>
  <div style="padding:34px 38px;display:flex;flex-direction:column;gap:26px">
    <div style="align-self:flex-end;max-width:70%;padding:22px 28px;border-radius:26px 26px 6px 26px;background:linear-gradient(135deg,#F6B94A,#E08C1E);color:#0B1420;font-weight:700;font-size:28px">Explain photosynthesis simply</div>
    <div style="display:flex;gap:18px;align-items:flex-start"><div style="width:58px;height:58px;border-radius:18px;background:#0B1420;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;flex:none">${icon.spark(34)}</div>
      <div class="bars" style="flex:1;padding:26px 30px;border-radius:6px 26px 26px 26px;background:rgba(255,255,255,.07);border:1px solid var(--line)"><span style="width:92%"></span><span style="width:100%"></span><span style="width:78%"></span><span style="width:55%;margin-bottom:0"></span></div></div>
    <div style="display:flex;gap:14px;margin-left:76px"><span class="pill" style="font-size:16px;padding:8px 18px">Summary</span><span class="pill" style="font-size:16px;padding:8px 18px">Quiz me</span><span class="pill" style="font-size:16px;padding:8px 18px">Documents</span></div>
    <div style="margin-top:6px;display:flex;align-items:center;gap:16px;padding:14px 18px;border-radius:22px;background:#0D1827;border:1px solid var(--line);width:430px"><div style="flex:1;height:14px;border-radius:7px;background:rgba(255,255,255,.10)"></div><div style="width:48px;height:48px;border-radius:15px;background:linear-gradient(135deg,#F6B94A,#E08C1E)"></div></div>
  </div>
</div>
<div class="glass" style="position:absolute;right:90px;bottom:56px;padding:26px 30px;display:flex;align-items:center;gap:20px;border-radius:28px;background:linear-gradient(160deg,#3A2A10,#1D1A18)">${icon.spark(70)}<div><div style="font-size:30px;font-weight:800">English and Kinyarwanda</div><div style="font-size:20px;color:var(--muted)">Made for our context</div></div></div>`);

const biz = () => shell('#4CE5D6', 'Bwenge4biz', `
<div style="position:absolute;left:330px;top:150px;width:360px;height:720px;border-radius:56px;background:#0A111B;border:2px solid rgba(255,255,255,.22);box-shadow:0 40px 90px -20px rgba(0,0,0,.8);padding:16px">
  <div style="height:100%;border-radius:42px;overflow:hidden;background:#F4F6FA;color:#0B1420;position:relative">
    <div style="height:170px;background:linear-gradient(135deg,#0B1420,#143246)"></div>
    <img src="${logoUrl}" style="position:absolute;left:24px;top:120px;width:86px;height:86px;border-radius:24px;border:4px solid #fff;box-shadow:0 8px 20px rgba(0,0,0,.25)"/>
    <div style="padding:70px 26px 0"><div style="display:flex;align-items:center;gap:8px;font-weight:800;font-size:26px">Your business ${icon.check(26)}</div><div style="font-size:16px;color:#5B6776;margin-top:4px">Your tagline goes here</div>
      <div style="margin-top:22px;display:flex;flex-direction:column;gap:12px">
        ${[['Lunch plan', '40,000 RWF'], ['Fresh juice', '1,500 RWF'], ['Delivery', '1,000 RWF']].map(([n, p]) => `<div style="display:flex;align-items:center;gap:14px;padding:12px;border-radius:16px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08)"><div style="width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#F6B94A,#E08C1E)"></div><div style="flex:1"><div style="font-weight:700;font-size:17px">${n}</div><div style="font-size:14px;color:#5B6776">${p}</div></div></div>`).join('')}
      </div>
      <div style="margin-top:20px;border-radius:18px;background:#25D366;color:#fff;font-weight:800;font-size:19px;text-align:center;padding:16px">Order on WhatsApp</div>
    </div></div></div>
<div class="glass" style="position:absolute;left:60px;top:300px;width:300px;padding:26px;border-radius:28px;background:linear-gradient(160deg,#143246,#0E2233)">
  <div style="font-weight:800;font-size:24px;margin-bottom:6px">Closing report</div><div style="font-size:16px;color:var(--muted);margin-bottom:22px">Sales, stock, who came</div>
  <div style="display:flex;align-items:flex-end;gap:12px;height:140px">${[48, 70, 56, 92, 74, 110, 130].map((h, i) => `<div style="flex:1;height:${h}px;border-radius:8px;background:${i === 6 ? 'linear-gradient(180deg,#4CE5D6,#1FB3A6)' : 'rgba(255,255,255,.18)'}"></div>`).join('')}</div></div>
<div class="glass" style="position:absolute;right:50px;top:330px;width:300px;padding:26px;border-radius:28px;background:linear-gradient(160deg,#3A2A10,#1D1A18)">
  <div style="font-weight:800;font-size:24px;margin-bottom:6px">Programs</div><div style="font-size:16px;color:var(--muted);margin-bottom:18px">Cards and passes</div>
  <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">${Array.from({ length: 18 }, (_, i) => `<div style="aspect-ratio:1;border-radius:8px;background:${i < 11 ? 'linear-gradient(135deg,#F6B94A,#E08C1E)' : 'rgba(255,255,255,.12)'}"></div>`).join('')}</div></div>
<div class="glass" style="position:absolute;right:90px;bottom:80px;padding:20px 26px;display:flex;align-items:center;gap:16px;border-radius:24px;background:#0E2233">${icon.check(44)}<div style="font-size:24px;font-weight:800">Verified</div></div>`);

const logoPng = async () => {
  const svg = readFileSync(logoSvg);
  const buf = await sharp(svg, { density: 400 }).resize(512, 512, { fit: 'contain', background: { r: 11, g: 20, b: 32, alpha: 1 } }).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(resolve(out, 'logo.png'), buf);
};

const browser = await chromium.launch();
const shoot = async (name, html, w, h, quality = 90) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const file = resolve(out, `.${name}.html`); writeFileSync(file, `<!doctype html><meta charset="utf-8">${html}`);
  await page.goto(pathToFileURL(file).href); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(400);
  const buf = await page.screenshot({ type: 'jpeg', quality, clip: { x: 0, y: 0, width: w, height: h } });
  writeFileSync(resolve(out, `${name}.jpg`), buf); await page.close(); (await import('node:fs')).unlinkSync(file);
  console.log(name, `${w}x${h}`, `${Math.round(buf.length / 1024)} KB`);
};
await logoPng(); console.log('logo 512x512');
await shoot('banner', banner(), 2400, 600, 88);
await shoot('myseb', myseb(), 1200, 900); await shoot('bwenge-ai', ai(), 1200, 900); await shoot('bwenge4biz', biz(), 1200, 900);
await browser.close();
