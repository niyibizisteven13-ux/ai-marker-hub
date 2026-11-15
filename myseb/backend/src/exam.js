import express from 'express';
import { q } from './db.js';

/**
 * A small built-in exam so the whole system can be tried without another site.
 * It is mounted behind mySebGuard, so every request here (page, script, answers) needs the MySEB key.
 * For a real exam site (e.g. bwenge.space) see docs/BWENGE.md: that site puts the same guard in front of its routes.
 */
export const examRouter = express.Router({ mergeParams: true });

const QUESTIONS = [
  { q: 'What is 12 × 12?', o: ['124', '144', '154'] },
  { q: 'Capital of Rwanda?', o: ['Kigali', 'Huye', 'Musanze'] },
  { q: 'Which gas do plants absorb?', o: ['Oxygen', 'Nitrogen', 'Carbon dioxide'] },
];

examRouter.get('/', async (req, res, next) => {
  let rows;
  try { ({ rows } = await q('SELECT title FROM exams WHERE id=$1', [req.params.examId])); } catch (e) { return next(e); }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  res.type('html').send(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(rows[0]?.title || 'Exam')}</title>
<style>body{font-family:system-ui;max-width:640px;margin:24px auto;padding:0 16px;line-height:1.5}fieldset{margin:16px 0;border:1px solid #cbd5e1;border-radius:8px}
button{padding:10px 18px;font-size:16px}</style>
<h1>${esc(rows[0]?.title || 'Exam')}</h1><p>Hello <b>${esc(req.myseb?.session.student_name || 'student')}</b>. Answer all questions.</p>
<form id=f>${QUESTIONS.map((x, i) => `<fieldset><legend>${i + 1}. ${esc(x.q)}</legend>${x.o.map((o) => `<label><input type=radio name=q${i} value="${esc(o)}"> ${esc(o)}</label><br>`).join('')}</fieldset>`).join('')}
<textarea name=essay rows=4 style="width:100%" placeholder="Short answer: why is exam integrity important?"></textarea><br><br>
<button>Submit</button> <span id=m></span></form>
<script src="app.js"></script>`);
});

// A sub-resource on purpose: proves scripts are guarded too (mobile uses the cookie fallback here).
examRouter.get('/app.js', (_req, res) => res.type('js').send(`
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await fetch('answers', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
  document.getElementById('m').textContent = r.ok ? 'Submitted. You can close the exam.' : 'Not accepted (' + r.status + ')';
});`));

examRouter.post('/answers', express.json({ limit: '50kb' }), (req, res) => {
  console.log(`[exam ${req.params.examId}] answers from ${req.myseb?.session.student_name ?? 'unguarded client'}:`, JSON.stringify(req.body));
  res.json({ ok: true });
});
