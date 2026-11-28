-- 离线补给箱：每个玩家每个箱子一行存档，倾向另存一行（见 Design/补给箱系统 v0.1.md）
-- 不用定时任务：已攒的数量读的时候按服务器时间现算，这里只存「从什么时候开始攒」和已结算的存货。
CREATE TABLE IF NOT EXISTS supply_boxes (
  user_id text NOT NULL,
  box_id text NOT NULL,
  accrued_from timestamptz NOT NULL,
  stock_hours double precision NOT NULL DEFAULT 0,
  stock jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, box_id)
);

CREATE TABLE IF NOT EXISTS supply_prefs (
  user_id text PRIMARY KEY,
  focus text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
