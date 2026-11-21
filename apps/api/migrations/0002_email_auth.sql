-- 邮箱登录：邮箱唯一，密码只存 scrypt 哈希
ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
  ON users (lower(email)) WHERE email IS NOT NULL;
