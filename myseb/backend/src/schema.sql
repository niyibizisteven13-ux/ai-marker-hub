CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS exams (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  exam_url         text NOT NULL,                        -- where the exam lives (must enforce the MySEB header, see guard)
  require_myseb    boolean NOT NULL DEFAULT true,        -- [x] Require MySEB
  allow_extension  boolean NOT NULL DEFAULT false,       -- accept the low-security Chrome extension as a client
  leave_action     text NOT NULL DEFAULT 'pause' CHECK (leave_action IN ('record','pause','end','pause_then_end')),
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
  client_type    text NOT NULL CHECK (client_type IN ('desktop','mobile','extension','web')),
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
ALTER TABLE exams ADD COLUMN IF NOT EXISTS live_source text NOT NULL DEFAULT 'camera';
-- Older databases: widen the allowed values, but only when needed (changing a constraint locks the table, so not at every start).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exams_leave_action_check' AND pg_get_constraintdef(oid) LIKE '%pause_then_end%') THEN
    ALTER TABLE exams DROP CONSTRAINT IF EXISTS exams_leave_action_check;
    ALTER TABLE exams ADD CONSTRAINT exams_leave_action_check CHECK (leave_action IN ('record','pause','end','pause_then_end'));
  END IF;
END $$;
-- Browser mode ("MySEB Web", for iPhones and anyone without the app): allowed per test, signed in with a secure cookie.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS allow_web boolean NOT NULL DEFAULT false;
-- Strict rules for students in a browser (iPhones): leaving the page, closing the tab, losing the camera or the face ends the test at once.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS web_strict boolean NOT NULL DEFAULT true;
-- More than one face in the camera (browsers): off, warn (a warning, recorded) or end (disqualified after a few seconds).
ALTER TABLE exams ADD COLUMN IF NOT EXISTS multi_face text NOT NULL DEFAULT 'warn';
-- Student card check at the start (browsers): the lecturer approves or refuses. The picture itself is never stored in the database: it waits in server memory until the decision.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS id_check boolean NOT NULL DEFAULT false;
ALTER TABLE exam_sessions ADD COLUMN IF NOT EXISTS id_status text NOT NULL DEFAULT 'none';
ALTER TABLE exam_sessions ADD COLUMN IF NOT EXISTS reinstated_count int NOT NULL DEFAULT 0;
ALTER TABLE exam_sessions ADD COLUMN IF NOT EXISTS ua_hash text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exam_sessions_client_type_check' AND pg_get_constraintdef(oid) LIKE '%web%') THEN
    ALTER TABLE exam_sessions DROP CONSTRAINT IF EXISTS exam_sessions_client_type_check;
    ALTER TABLE exam_sessions ADD CONSTRAINT exam_sessions_client_type_check CHECK (client_type IN ('desktop','mobile','extension','web'));
  END IF;
END $$;
