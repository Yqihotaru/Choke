-- 技能重洗「逢 5 自选」单卡独立保底计数（每张卡独立累计，第 5 次自选后归零）
ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS skill_reroll_count integer NOT NULL DEFAULT 0;
