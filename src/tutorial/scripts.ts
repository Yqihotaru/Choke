import type { TutorialPlayableStep, TutorialScript } from "./types"

/** 只用来显示“第几步 / 共几步”，顺序必须和流程一致 */
export const TUTORIAL_STEP_ORDER: TutorialPlayableStep[] = [
  "welcome",
  "gacha-entry",
  "gacha-open",
  "album",
  "album-view",
  "deck",
  "deck-view",
  "battle-tab",
  "battle-view",
  "battle-result",
  "graduation",
]

/**
 * 台词配置表。
 *
 * 数值约定（必须和 store.ts 的 LEVEL_EXP_REQUIRED 对齐）：
 *   Lv.1 → Lv.2：100 EXP（album-view 继续）
 *   Lv.2 → Lv.3：150 EXP（deck-view 80 + battle-view 70）
 * 走完教程正好 Lv.3，不会多也不会少。
 */
export const TUTORIAL_SCRIPTS = {
  welcome: {
    advanceOn: "continue",
    next: "gacha-entry",
    lines: [
      {
        mood: "idle",
        text: "哟，新面孔。欢迎来到 Choke! —— 一个把 osu! 玩家做成卡牌的地方。",
      },
      {
        mood: "happy",
        text: "规则很简单：开包收卡 → 组一套卡组 → 上桌打一场。打不过也别慌，这里不掉 pp。",
      },
      {
        mood: "smug",
        text: "新手礼包已经塞进你背包了。先把第一包开了——手气这东西，越紧张越 choke。",
      },
    ],
  },

  "gacha-entry": {
    target: ({ bookOpen }) => (bookOpen ? "book-tab-packs" : "packs-entry"),
    advanceOn: "click",
    next: "gacha-open",
    lines: [
      {
        mood: "idle",
        text: "看到桌上那个卡包展架了吗？点它，抽卡面板就会翻开。",
      },
      {
        mood: "smug",
        text: "放心，第一包算我的。开坏了也不扣 acc。",
      },
    ],
  },

  "gacha-open": {
    // 有库存时高亮「开 5 张」；库存为空时 GachaPanel 会换成「领取新手卡包」
    target: ["gacha-open-button", "gacha-restock"],
    advanceOn: "event",
    event: "pack-opened",
    next: "album",
    lines: [
      {
        mood: "happy",
        text: "点『开 5 张』。开出什么先别尖叫，卡册里都能找到。",
      },
      {
        mood: "idle",
        text: "如果出重复卡，别哭——重复卡能熔成经验。收藏家的第一课。",
      },
    ],
  },

  album: {
    target: ({ bookOpen }) => (bookOpen ? "book-tab-album" : "album-entry"),
    advanceOn: "click",
    next: "album-view",
    lines: [
      {
        mood: "idle",
        text: "抽完的卡已经进卡册了。走，去认认脸。",
      },
    ],
  },

  "album-view": {
    target: "album-grid",
    advanceOn: "continue",
    exp: 100,
    next: "deck",
    lines: [
      {
        mood: "happy",
        text: "这些就是你的第一批收藏。点卡面能看详情，拖到桌面还能摆着玩。",
      },
      {
        mood: "smug",
        text: "很好，Lv.2。卡组和对战垫已经解锁了，接下来该组一套能打的牌。",
      },
    ],
  },

  deck: {
    target: ({ bookOpen }) => (bookOpen ? "book-tab-deck" : "deck-entry"),
    advanceOn: "click",
    next: "deck-view",
    lines: [
      {
        mood: "idle",
        text: "点开卡组。右边是你的卡，左边是 7 个槽位。",
      },
      {
        mood: "smug",
        text: "新手别追求满编，先凑一套能出战的就行。",
      },
    ],
  },

  "deck-view": {
    target: "deck-tutorial-confirm",
    advanceOn: "event",
    event: "deck-confirmed",
    exp: 80,
    next: "battle-tab",
    lines: [
      {
        mood: "idle",
        text: "看到『一键上阵，去战斗』了吗？点它，我帮你把卡塞进槽位。",
      },
      {
        mood: "happy",
        text: "卡组不用完美，先上场挨打，才知道缺什么。",
      },
    ],
  },

  "battle-tab": {
    target: "book-tab-battle",
    advanceOn: "click",
    next: "battle-view",
    lines: [
      {
        mood: "idle",
        text: "现在翻到战斗页。对手是练习用的谱面幽灵，不会真的咬人。",
      },
    ],
  },

  "battle-view": {
    target: "battle-tutorial-start",
    advanceOn: "event",
    event: "battle-finished",
    exp: 70,
    next: "battle-result",
    lines: [
      {
        mood: "serious",
        text: "点『进入教学对战』，会跳到真正的对战页。这一场我陪你打，输了也算我的。",
      },
      {
        mood: "smug",
        text: "教学战不计排名，掉不了你的 pp。放心按下去。",
      },
    ],
  },

  "battle-result": {
    advanceOn: "continue",
    next: "graduation",
    lines: [
      {
        mood: "happy",
        text: "教学战结束！练习赛不计胜负，你已经完整走了一遍战斗流程。",
      },
      {
        mood: "smug",
        text: "Lv.3 达成。新手教程，毕业！",
      },
    ],
  },

  graduation: {
    advanceOn: "continue",
    next: "done",
    closeBookOnExit: true,
    lines: [
      {
        mood: "idle",
        text: "背包、图鉴、邀请函现在都开放了。随便逛，别把卡册弄乱。",
      },
      {
        mood: "serious",
        text: "继续做任务、打对战升级。到 Lv.6，市场木箱就会自己开锁。",
      },
      {
        mood: "happy",
        text: "去吧。记得——别 choke。",
      },
    ],
  },
} satisfies Record<TutorialPlayableStep, TutorialScript>

/** 角色信息单独放，后面要换立绘 / 名字只改这里 */
export const TUTORIAL_CHARACTER = {
  name: "发牌员 · 阿圈",
  title: "Choke! 发牌员",
} as const
