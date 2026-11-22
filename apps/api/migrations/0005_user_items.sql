-- 物品表：碎片分 7 档（shard-C … shard-Prismatic）+ 经验道具（exp-small/medium/large）
CREATE TABLE IF NOT EXISTS user_items (
  user_id text NOT NULL,
  item_id text NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (user_id, item_id)
);

-- 卡牌经验整体 ×10（经济与养成 v0.3 §6.1 ×10）。
-- 旧碎片 1 个 = 1 旧经验 = 10 新经验 = 1 个 C 碎片，按 1:1 迁移，经验价值不变。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'shards'
  ) THEN
    INSERT INTO user_items (user_id, item_id, count)
    SELECT id, 'shard-C', shards FROM users WHERE shards > 0
    ON CONFLICT (user_id, item_id) DO UPDATE SET count = user_items.count + EXCLUDED.count;
    ALTER TABLE users DROP COLUMN shards;
    UPDATE user_cards SET exp = exp * 10;
  END IF;
END $$;
