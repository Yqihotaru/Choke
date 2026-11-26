import { fetchUserCards, type ApiUserCard } from "@/desk/session/api"

/** 把玩家的全部卡分页取回来（接口一页最多 60 张），按稀有度排序 */
export async function loadAllCards(userId: string, signal?: AbortSignal): Promise<ApiUserCard[]> {
  const rows: ApiUserCard[] = []
  for (let page = 0; page < 30; page += 1) {
    const res = await fetchUserCards(userId, { sort: "rarity", page, limit: 60, signal })
    rows.push(...res.rows)
    if (res.rows.length === 0 || rows.length >= res.total) break
  }
  return rows
}
