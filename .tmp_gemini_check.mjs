import jwt from 'jsonwebtoken';

const token = jwt.sign({ userId: 'test-user', email: 'test@example.com' }, 'bwenge_super_secret_key_2026', { expiresIn: '1h' });

const res = await fetch('http://127.0.0.1:3000/api/ai/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ query: 'Please summarize this test prompt.', documentContext: 'Test document' }),
});

const body = await res.text();
console.log('STATUS', res.status);
console.log(body);
