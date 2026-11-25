import "./page-loading.css"

/** 整页的加载占位：换页、懒加载的 chunk 还没到时显示。颜色跟桌面一致，不会先闪一下别的底色。 */
export function PageLoading({ label = "加载中" }: { label?: string }) {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="page-loading__mark" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span className="page-loading__text">{label}</span>
    </div>
  )
}
