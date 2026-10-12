CREATE INDEX CONCURRENTLY IF NOT EXISTS ask_tasks_session_status_idx ON ask_tasks (session_id, status);
