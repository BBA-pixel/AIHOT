CREATE INDEX CONCURRENTLY IF NOT EXISTS ask_messages_session_idx ON ask_messages (session_id, created_at);
