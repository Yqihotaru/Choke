-- 账号绑定与进度继承：游客号、邮箱号绑定一个已经有进度的 osu! 号时，落选的一边封存（不合并）。
-- 封存 = 释放邮箱和 osu! id（另存一份方便客服恢复），不能登录；数据留着，30 天后才允许清理。
ALTER TABLE users ADD COLUMN IF NOT EXISTS sealed_at timestamptz;
-- 封存时留下的账号去向（赢的那个账号 id）
ALTER TABLE users ADD COLUMN IF NOT EXISTS sealed_into text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sealed_osu_id bigint;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sealed_email text;
