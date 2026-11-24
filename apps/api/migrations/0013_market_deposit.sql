-- 市场挂单押金（防止天价挂单；成交、主动下架或 7 天过期自动取消时退还，上架税不退）
ALTER TABLE market_listings ADD COLUMN IF NOT EXISTS deposit integer NOT NULL DEFAULT 0;
