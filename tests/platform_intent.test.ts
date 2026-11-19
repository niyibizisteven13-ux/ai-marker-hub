import test from 'node:test';
import assert from 'node:assert/strict';
import { needsPlatformTools } from '../server/services/ai/platformIntent.js';

// Which messages get the tools: requests about the user's own exams, classes, marks and live rooms, in three languages; not general questions.
const yes = [
  'How is my exam going?', 'who was disqualified in the live room', 'Give me a code for students', 'Make a 45-minute protected quiz on cells and give me the link',
  'Who passed my S4 class?', 'mark my homework with this scheme', 'release the results of the mock exam', 'show me the marks of my students',
  'turn on browser mode for iPhones', 'Let Ben back in', 'list my forms', 'export the gradebook', 'how many students have submitted?', 'close the task for S3',
  'Add these students to my class: 2201 Aline', 'what did Ben write before he left? (saved answers)', 'close my test', 'who is late in this class',
  'Montre-moi les résultats de mon examen', 'Combien d’étudiants ont rendu le devoir ?', 'ouvre ma classe',
  'Erekana amanota y’abanyeshuri banjye', 'Fungura ikizamini cyanjye', 'MySEB code please', 'Make a practice class for S3 and give me the join code', 'change Ann\'s mark for question 3 on the mock exam', 'show me Ann\'s marks per question',
];
const no = [
  'What is photosynthesis?', 'Explain what a quiz is', 'Write me a poem about rain', 'hello', 'How do I prepare for a test?', 'Tips for exams',
  'translate this sentence into French', 'what is the capital of Rwanda', 'Define the word result', 'Qu’est-ce qu’un examen ?',
];
test('platform requests get the tools', () => { for (const m of yes) assert.ok(needsPlatformTools(m), `should be a platform request: ${m}`); });
test('general questions do not', () => { for (const m of no) assert.ok(!needsPlatformTools(m), `should not be a platform request: ${m}`); });

import { needsPlatformTools as needs } from '../server/services/ai/platformIntent.js';
test('business messages get the tools (the normal chat can run the dashboard), general talk about business does not', () => {
  for (const m of ['Today I sold 5 loaves for 4,000', 'i spent 8000 on flour', 'how is my business doing today?', 'what are my sales this week', 'what is running out? restock rice', 'post an update to my page with a promotion', 'ask 0788 123 456 to pay 3,000', 'publish my page', 'close the day', 'nacuruje ibiro 5 ku 4000', "j'ai vendu 3 gâteaux", 'show pending orders', 'record a sale of 2,500', 'add an expense of 1,000 for transport'])
    assert.equal(needs(m), true, m);
  for (const m of ['What is profit margin?', 'Explain how to start a small business', 'hello there my friend', 'write a poem about the sea'])
    assert.equal(needs(m), false, m);
});

test('language change requests reach the tools', () => {
  for (const m of ['put my dashboard in Kinyarwanda', 'switch my page to english', 'change my dashboard to French', 'make my business page open in Kinyarwanda', 'hindura ururimi', 'shyira dashboard mu kinyarwanda']) assert.equal(needs(m), true, m);
  assert.equal(needs('what is the Kinyarwanda word for stock?'), false);
});
