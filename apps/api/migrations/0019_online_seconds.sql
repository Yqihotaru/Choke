-- 在线时长统计：挂机包按在线时间累计。online_seconds 是重置日 online_day 里的累计在线秒数
ALTER TABLE users ADD COLUMN IF NOT EXISTS online_day text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS online_seconds integer NOT NULL DEFAULT 0;
