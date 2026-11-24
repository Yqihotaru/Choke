-- 本体卡吞噬镜像卡共鸣（v0.3 §7.5）
CREATE TABLE IF NOT EXISTS hero_resonance (
  user_id        text NOT NULL,
  source_card_id text NOT NULL,
  attribute      text NOT NULL,
  value_bp       integer NOT NULL,
  slot           integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source_card_id)
);

CREATE INDEX IF NOT EXISTS hero_resonance_user_attr_idx
  ON hero_resonance (user_id, attribute);
