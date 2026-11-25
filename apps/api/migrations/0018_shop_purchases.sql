-- 统一商店限购计数：按 (user_id, item_id, period_key) 统计日/周/月已购次数
CREATE TABLE IF NOT EXISTS shop_purchases (
  user_id text NOT NULL,
  item_id text NOT NULL,
  period_key text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id, period_key)
);
