import type { OsuScore } from "@choke/shared/osu-daily"

import { CLIENT_ID, CLIENT_SECRET } from "./auth/env"

/**
 * osu! 公开接口的最小客户端：用应用自己的 client credentials 令牌读公开成绩，玩家不用重新授权。
 * 做成可替换的（setOsuApi），测试里换成假的，不会真的联网。
 */
export interface OsuApi {
  /** 某玩家在某张谱面上的全部成绩（所有 mod、所有时间）；谱面不存在返回空数组 */
  userScoresOnBeatmap(beatmapId: number, osuUserId: number): Promise<OsuScore[]>
}

/** osu! 接口出错（网络、限频、令牌）：调用方转成「稍后再试」 */
export class OsuApiError extends Error {}

const TOKEN_URL = "https://osu.ppy.sh/oauth/token"
const API_BASE = "https://osu.ppy.sh/api/v2"
const TIMEOUT_MS = 8000

let token: { value: string; expiresAt: number } | null = null

async function getToken(force: boolean): Promise<string> {
  if (!force && token && token.expiresAt > Date.now() + 60_000) return token.value
  if (!CLIENT_ID || !CLIENT_SECRET) throw new OsuApiError("服务器没有配置 osu! 应用密钥")
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: Number(CLIENT_ID),
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
      scope: "public",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new OsuApiError(`osu! 令牌请求失败（${response.status}）`)
  const body = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) throw new OsuApiError("osu! 令牌响应里没有 access_token")
  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 }
  return token.value
}

async function request(path: string, retried = false): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${await getToken(retried)}`,
      Accept: "application/json",
      // 新版成绩格式：带 ended_at 和 ruleset_id
      "x-api-version": "20220705",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (response.status === 401 && !retried) return request(path, true)
  return response
}

const realApi: OsuApi = {
  async userScoresOnBeatmap(beatmapId, osuUserId) {
    let response: Response
    try {
      response = await request(`/beatmaps/${beatmapId}/scores/users/${osuUserId}/all`)
    } catch (error) {
      if (error instanceof OsuApiError) throw error
      throw new OsuApiError(`osu! 接口连不上：${(error as Error).message}`)
    }
    if (response.status === 404) return []
    if (!response.ok) throw new OsuApiError(`osu! 接口返回 ${response.status}`)
    const body = (await response.json()) as { scores?: OsuScore[] }
    return Array.isArray(body.scores) ? body.scores : []
  },
}

let current: OsuApi = realApi

export const osuApi: OsuApi = {
  userScoresOnBeatmap: (beatmapId, osuUserId) => current.userScoresOnBeatmap(beatmapId, osuUserId),
}

/** 测试用：换成假的 osu! 接口（传 null 还原） */
export function setOsuApi(next: OsuApi | null): void {
  current = next ?? realApi
}
