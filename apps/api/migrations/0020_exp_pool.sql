-- 经验池：首通奖励和补给箱发的经验先存在这里，玩家再随意分给任何一张卡。不能交易、不能转赠。
ALTER TABLE users ADD COLUMN IF NOT EXISTS exp_pool integer NOT NULL DEFAULT 0;
