-- 分解碎片：分解卡得碎片，碎片 1:1 换经验
ALTER TABLE users ADD COLUMN IF NOT EXISTS shards integer NOT NULL DEFAULT 0;
