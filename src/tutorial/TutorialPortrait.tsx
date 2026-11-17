/**
 * 引导角色立绘位。
 *
 * 现在没有正式美术，只渲染一个占位框；有图后把 PORTRAIT_SRC 换成
 * "/tutorial/aquan.webp"（或任意外链）即可，布局不用动。
 * 如需按台词切表情，可以把 src 改成 `portraits[mood]`。
 */
const PORTRAIT_SRC: string | undefined = undefined

export function TutorialPortrait({
  src = PORTRAIT_SRC,
  alt = "引导角色立绘",
}: {
  src?: string
  alt?: string
}) {
  if (src) {
    return (
      <img
        className="tut-portrait__img"
        src={src}
        alt={alt}
        draggable={false}
      />
    )
  }

  return (
    <div className="tut-portrait__placeholder" role="img" aria-label="立绘占位">
      <span>PORTRAIT</span>
      <b>立绘占位</b>
    </div>
  )
}
