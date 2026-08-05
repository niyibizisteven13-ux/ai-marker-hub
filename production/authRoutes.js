import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createUser, findUserByEmail } from './authDb.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'bwenge_auth_secret_2026';
const JWT_EXPIRES_IN = '7d';

function buildAuthResponse(user) {
  const payload = { userId: user.id, email: user.email, name: user.name };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  return { token, user: { id: user.id, name: user.name, email: user.email } };
}

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    const existing = findUserByEmail(email);
    if (existing) {
      return res.status(400).json({ error: 'An account with that email already exists.' });
    }

    const user = await createUser(name, email, password);
    const authPayload = buildAuthResponse(user);
    return res.status(201).json({ success: true, message: 'Account created successfully.', ...authPayload });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({ error: 'Failed to register user.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const authPayload = buildAuthResponse(user);
    return res.json({ success: true, message: 'Logged in successfully.', ...authPayload });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

router.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.json({ success: true, user: decoded });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
});

export default router;
