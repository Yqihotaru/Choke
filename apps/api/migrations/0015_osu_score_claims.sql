-- 每日推荐谱面：用过的 osu! 成绩。同一条成绩（score_id）只能换一次奖，换号、换天都不行。
CREATE TABLE IF NOT EXISTS osu_score_claims (
  score_id bigint PRIMARY KEY,
  user_id text NOT NULL,
  beatmap_id integer NOT NULL,
  -- 用这条成绩通过的重置日（YYYY-MM-DD）
  day_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 查「某玩家今天有没有通过」
CREATE INDEX IF NOT EXISTS osu_score_claims_user_day_idx ON osu_score_claims (user_id, day_key);
