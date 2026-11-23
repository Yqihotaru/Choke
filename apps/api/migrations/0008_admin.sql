-- 管理员后台：账号标记、群发批次记录、邮件对应的批次。
-- is_admin 只能在数据库里改（scripts/set-admin.ts），没有任何接口能把人设成管理员。
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS admin_mail_batches (
  id serial PRIMARY KEY,
  admin_id text NOT NULL,
  -- { type: users | all | level, ... }
  audience jsonb NOT NULL,
  recipient_count integer NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  attachment jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_mail_batches_created_idx ON admin_mail_batches (created_at DESC);

ALTER TABLE mails ADD COLUMN IF NOT EXISTS batch_id integer;
