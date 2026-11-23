-- 技能从卡定义搬到卡实例：同名卡每张各掷各的技能，发出去就固定。
-- 旧数据：玩家手里已有的卡先拿卡定义上的技能顶着，卡定义上的技能列随后删除。
ALTER TABLE user_cards ADD COLUMN IF NOT EXISTS skill_refs jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cards' AND column_name = 'skill_refs'
  ) THEN
    UPDATE user_cards uc
    SET skill_refs = c.skill_refs
    FROM cards c
    WHERE uc.card_id = c.id AND uc.skill_refs = '[]'::jsonb;
    ALTER TABLE cards DROP COLUMN skill_refs;
  END IF;
END $$;
