-- 卡的技能只存技能 id（skill_refs），旧的卡面技能列删除，不做兼容
ALTER TABLE cards DROP COLUMN IF EXISTS skills;
