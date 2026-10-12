CREATE TABLE IF NOT EXISTS ask_messages (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES ask_sessions(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  task_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
