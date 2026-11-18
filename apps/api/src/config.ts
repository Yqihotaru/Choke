/** 全局规则常量。前端通过 GET /config 读取，避免各层再各写一份。 */

/** 出战卡组槽位数；PUT /users/:id/deck 会按这个长度校验。 */
export const DECK_SIZE = 7
