CREATE TABLE IF NOT EXISTS ask_sessions (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  client_key text NULL
);
