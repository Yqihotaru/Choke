-- 体力与副本记录
ALTER TABLE users ADD COLUMN IF NOT EXISTS stamina integer NOT NULL DEFAULT 240;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stamina_updated_at bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS dungeon_runs (
  id serial PRIMARY KEY,
  user_id text NOT NULL,
  dungeon text NOT NULL,
  cost integer NOT NULL,
  rewards jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dungeon_runs_user_idx ON dungeon_runs (user_id, created_at DESC);
