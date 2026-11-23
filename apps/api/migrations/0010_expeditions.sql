-- 远征：一次出征的全部进度都存在服务端。每个玩家同一时间最多一个未结束（active / suspended）的远征。
CREATE TABLE IF NOT EXISTS expeditions (
  id serial PRIMARY KEY,
  user_id text NOT NULL,
  map_id text NOT NULL,
  -- active 进行中 / suspended 保存并退出 / settled 已结算 / abandoned 已放弃 / expired 已过期
  status text NOT NULL DEFAULT 'active',
  seed text NOT NULL,
  -- 开始时的内容版本；地图、遭遇都存了快照，这里只是留档
  content_version text NOT NULL,
  -- 地图快照（MapDef）
  map jsonb NOT NULL,
  -- 卡池快照：[{ userCardId, face }]，途中强化不影响
  pool jsonb NOT NULL,
  -- 点数分配：{ slots, apUpgrade, maxRarity }
  allocation jsonb NOT NULL,
  position text NOT NULL,
  node_done boolean NOT NULL DEFAULT false,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 队伍血量占最大生命的比例，跨战斗保留
  hp_ratio double precision NOT NULL DEFAULT 1,
  -- 攒下的奖励：[{ node, reward }]，结算时一次性发
  drops jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 开始时冻结的体力（拿到东西才真正花掉，否则退回）
  stamina_cost integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  -- cleared / early / abandoned / expired
  end_reason text,
  settlement jsonb
);
CREATE INDEX IF NOT EXISTS expeditions_user_idx ON expeditions (user_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS expeditions_one_open_idx ON expeditions (user_id)
  WHERE status IN ('active', 'suspended');

CREATE TABLE IF NOT EXISTS expedition_battles (
  id serial PRIMARY KEY,
  expedition_id integer NOT NULL,
  node_id text NOT NULL,
  -- preparing 选阵容 / fighting 战斗中 / won / lost
  status text NOT NULL DEFAULT 'preparing',
  -- 进入节点时的遭遇数据快照（EncounterSpec）
  encounter jsonb NOT NULL,
  seed text NOT NULL,
  ap_max integer NOT NULL,
  hp_ratio_start double precision NOT NULL,
  lineup jsonb NOT NULL DEFAULT '[]'::jsonb,
  bench jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  retries integer NOT NULL DEFAULT 0,
  stars integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS expedition_battles_node_idx ON expedition_battles (expedition_id, node_id);

CREATE TABLE IF NOT EXISTS map_clears (
  user_id text NOT NULL,
  map_id text NOT NULL,
  best_stars integer NOT NULL DEFAULT 0,
  clears integer NOT NULL DEFAULT 0,
  first_cleared_at timestamptz NOT NULL DEFAULT now(),
  last_cleared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, map_id)
);

-- 图鉴数据：每个敌人击败过几次、揭开过哪些隐藏弱点
CREATE TABLE IF NOT EXISTS bestiary (
  user_id text NOT NULL,
  enemy_id text NOT NULL,
  defeated integer NOT NULL DEFAULT 0,
  hidden_found jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (user_id, enemy_id)
);
