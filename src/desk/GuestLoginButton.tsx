/**
 * 游客入口：跳过 osu! OAuth，直接创建一个 guest-xxxx 账号进入桌面。
 * 登录由 API 的 GET /auth/guest 完成，随后重定向回桌面。
 */
export function GuestLoginButton({
  className = "bk-btn",
  label = "游客账户",
}: {
  className?: string
  label?: string
}) {
  return (
    <a
      className={className}
      href="/auth/guest"
      title="不绑定 osu!，直接试用桌面；游客没有本体卡"
    >
      {label}
    </a>
  )
}
