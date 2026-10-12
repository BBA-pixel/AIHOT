CREATE TABLE IF NOT EXISTS ask_evidence (
  id int NOT NULL,
  task_id uuid NOT NULL REFERENCES ask_tasks(id) ON DELETE CASCADE,
  kind text NOT NULL,
  object_id text NULL,
  title text NULL,
  source_name text NULL,
  published_at timestamptz NULL,
  site_url text NULL,
  original_url text NULL,
  tool_name text NULL,
  raw_ref jsonb NULL,
  public_ok boolean NOT NULL DEFAULT true,
  PRIMARY KEY (task_id, id)
);
