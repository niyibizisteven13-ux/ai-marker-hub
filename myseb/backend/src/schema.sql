CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS exams (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  exam_url         text NOT NULL,                        -- where the exam lives (must enforce the MySEB header, see guard)
  require_myseb    boolean NOT NULL DEFAULT true,        -- [x] Require MySEB
  allow_extension  boolean NOT NULL DEFAULT false,       -- accept the low-security Chrome extension as a client
  leave_action     text NOT NULL DEFAULT 'pause' CHECK (leave_action IN ('record','pause','end')),
  duration_minutes integer NOT NULL DEFAULT 60,          -- per student, counted from entering the code
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  ends_at          timestamptz,                          -- set when the teacher ends the exam
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Only hashes are stored: the code and the secret are shown to the teacher once.
CREATE TABLE IF NOT EXISTS exam_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id     uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  secret_hash text NOT NULL,                             -- exam secret: lets the exam host call /api/gate
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS exam_codes_code_hash_idx ON exam_codes(code_hash);

CREATE TABLE IF NOT EXISTS exam_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id        uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  code_id        uuid NOT NULL REFERENCES exam_codes(id) ON DELETE CASCADE,
  student_name   text NOT NULL,
  token_hash     text NOT NULL,                          -- the per-student one-time key (hash only)
  status         text NOT NULL DEFAULT 'IN_EXAM' CHECK (status IN ('IN_EXAM','PAUSED','LEFT','ENDED')),
  client_type    text NOT NULL CHECK (client_type IN ('desktop','mobile','extension')),
  platform       text,
  device_id      text NOT NULL,                          -- the token is bound to this device on first use
  started_at     timestamptz NOT NULL DEFAULT now(),
  deadline_at    timestamptz NOT NULL,
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  end_reason     text,
  pause_reason   text,
  violation_count integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS exam_sessions_token_idx ON exam_sessions(token_hash);
CREATE INDEX IF NOT EXISTS exam_sessions_exam_idx ON exam_sessions(exam_id, status);

CREATE TABLE IF NOT EXISTS violations (
  id         bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  exam_id    uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  type       text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS violations_session_idx ON violations(session_id, created_at DESC);

-- Live room: the lecturer may ask for small camera pictures (kept in memory only, never in the database).
ALTER TABLE exams ADD COLUMN IF NOT EXISTS live_faces boolean NOT NULL DEFAULT false;

-- Camera in the live room: off, small pictures every 10 s, or live video (and optionally sound the lecturer can listen to).
ALTER TABLE exams ADD COLUMN IF NOT EXISTS live_mode text NOT NULL DEFAULT 'off';
ALTER TABLE exams ADD COLUMN IF NOT EXISTS live_sound boolean NOT NULL DEFAULT false;
UPDATE exams SET live_mode = 'pictures' WHERE live_faces AND live_mode = 'off';
