-- 邮箱 + 流水。邮件保留 30 天，被 Pin 的不删；流水记录所有货币、道具、卡包、卡牌的增减。
CREATE TABLE IF NOT EXISTS mails (
  id serial PRIMARY KEY,
  user_id text NOT NULL,
  kind text NOT NULL DEFAULT 'system',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  -- null = 没有附件；格式见 packages/shared/src/mail.ts
  attachment jsonb,
  read_at timestamptz,
  claimed_at timestamptz,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mails_user_created_idx ON mails (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  -- coins / essence / stamina / item / pack / card
  kind text NOT NULL,
  -- 物品 id、卡包 id、卡 id；货币留空
  ref text NOT NULL DEFAULT '',
  -- 正数是得到，负数是失去
  delta integer NOT NULL,
  -- 来源：mail-claim、mail-auto……
  source text NOT NULL,
  source_ref text,
  -- 卡牌实例（只有 kind = card 时有）
  user_card_id integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_user_idx ON ledger_entries (user_id, id DESC);
