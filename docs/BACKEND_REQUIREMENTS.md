# Bwenge Backend Authentication & API Requirements

## 1. Authentication & Session Management
- **Cookies**: HttpOnly, Secure, SameSite=Lax session cookies rotated on login.
- **CSRF Protection**: Double-submit cookie pattern using `XSRF-TOKEN` cookie echoed in header `X-XSRF-TOKEN`.
- **Password Hashing**: Argon2id or bcrypt (cost factor >= 12).
- **Constant-Time Comparison**: Implement constant-time comparison for passwords and API tokens.
- **Generic Error Responses**: Return identical 401 Unauthorized responses for unknown usernames and incorrect passwords to prevent user enumeration.

## 2. Rate Limiting & Security
- **Login Rate Limit**: Maximum 5 failed login attempts per 15 minutes per IP and identifier. Return HTTP 429 with `Retry-After` header.
- **OTP Security**: 6-digit cryptographically secure random OTP codes, hashed in database, 5-minute single-use expiration, maximum 5 attempts per OTP, max 3 requests per 15 minutes per phone number.

## 3. Endpoints Contract
- `POST /api/auth/login`: Body `{ identifier, password }`. Returns 200 `{ user: { id, name, email, role } }`.
- `POST /api/auth/otp/request`: Body `{ phone }`. Returns 200 `{ retryAfter: 30 }`.
- `POST /api/auth/otp/verify`: Body `{ phone, code }`. Returns 200 `{ user: { id, name, email, role } }`.
- `POST /api/auth/google`: Exchanges Google OAuth code. Returns 200 `{ user: { id, name, email, role } }`.
- `GET /api/auth/me`: Returns 200 `{ user: { id, name, email, role } }` or 401.
- `POST /api/auth/logout`: Clears session cookie. Returns 204.
