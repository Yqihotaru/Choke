-- 任务进度与签到记录。按「周期编号」分开存：换了周期就是新的一行，不需要定时重置。
--   日常 / 签到：period_key = 重置日（YYYY-MM-DD，每天 4:00 换）
--   周常：period_key = 这周周一的重置日（周一 4:00 换）
--   月常：period_key = YYYY-MM（每月 1 日 4:00 换）
-- 签到用固定的 quest_id = 'sign-in'，progress 恒为 1，领取时间就是签到时间。
CREATE TABLE IF NOT EXISTS quest_progress (
  user_id text NOT NULL,
  quest_id text NOT NULL,
  period_key text NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  -- 周期结束后没领、由系统发到邮箱的
  auto_claimed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, quest_id, period_key)
);
-- 到期扫描：找某个玩家还没领的行
CREATE INDEX IF NOT EXISTS quest_progress_unclaimed_idx ON quest_progress (user_id) WHERE claimed_at IS NULL;
