-- 难度系统第 2 步：出征的威胁值（档位由它换算），地图通关目标的历史最佳
ALTER TABLE expeditions ADD COLUMN IF NOT EXISTS threat integer NOT NULL DEFAULT 0;
ALTER TABLE map_clears ADD COLUMN IF NOT EXISTS best_objectives integer NOT NULL DEFAULT 0;
