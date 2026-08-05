import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_API_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const DEEPSEEK_URL = `${DEEPSEEK_BASE_URL}/v1/chat/completions`;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || process.env['Deepseek-API-KEY'] || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

export async function evaluateStudentSubmission(examPaper, rubrics, rawStudentText) {
  if (!DEEPSEEK_KEY) {
    throw new Error('DEEPSEEK_API_KEY is not configured.');
  }

  const prompt = `Grade the student submission using the exam and rubrics provided. Return JSON in the exact schema described below.\n\nEXAM AND RUBRICS:\n${JSON.stringify({ examPaper, rubrics }, null, 2)}\n\nSTUDENT TEXT:\n${rawStudentText}`;

  try {
    const resp = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4000,
      }),
    });

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || data?.output || data?.text || data?.result || JSON.stringify(data);

    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (err) {
      const str = String(raw || '');
      const fenced = str.match(/```(?:json)?([\s\S]*?)```/i);
      const content = fenced ? fenced[1].trim() : str;
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Deepseek evaluateStudentSubmission error:', error);
    throw error;
  }
}

export async function sendDeepseekChat(prompt) {
  if (!DEEPSEEK_KEY) throw new Error('DEEPSEEK_API_KEY is not configured.');

  try {
    const resp = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1200,
      }),
    });

    const data = await resp.json();
    return (data?.choices?.[0]?.message?.content || data?.output || data?.text || data?.result || '').toString();
  } catch (error) {
    console.error('Deepseek sendDeepseekChat error:', error);
    throw error;
  }
}
