CREATE TABLE IF NOT EXISTS ask_events (
  task_id uuid NOT NULL REFERENCES ask_tasks(id) ON DELETE CASCADE,
  seq int NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, seq)
);
