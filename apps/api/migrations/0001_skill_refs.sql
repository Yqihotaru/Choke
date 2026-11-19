-- 技能引用：卡面不再直接存技能行为，只存技能 id
ALTER TABLE cards ADD COLUMN IF NOT EXISTS skill_refs jsonb NOT NULL DEFAULT '[]'::jsonb;
