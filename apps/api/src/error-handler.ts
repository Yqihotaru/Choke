import type { FastifyError, FastifyReply, FastifyRequest } from "fastify"
import { ZodError } from "zod"

/** 统一的 404：未匹配路由也是 {ok:false,error}，前端不用再猜 Fastify 的默认结构 */
export function notFoundHandler(_request: FastifyRequest, reply: FastifyReply) {
  return reply.code(404).send({
    ok: false,
    error: { code: "not_found", message: "接口不存在" },
  })
}

/** 请求体解析失败（非法 JSON、空 body、超出限制等）都归成客户端输入错误 */
function isBodyParseError(error: FastifyError): boolean {
  return typeof error.code === "string" && error.code.startsWith("FST_ERR_CTP_")
}

/** schema.parse() 抛的 ZodError 是客户端输入问题：回 400；500 统一脱敏，细节只写服务端日志。 */
export function handleError(error: FastifyError | ZodError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      ok: false,
      error: {
        code: "bad_request",
        message: "请求参数不合法",
        details: error.flatten(),
      },
    })
  }
  const status = typeof error.statusCode === "number" ? error.statusCode : 500
  if (status >= 500) {
    request.log.error(error, "unhandled server error")
    return reply.code(500).send({
      ok: false,
      error: {
        code: "internal",
        message: "服务器出错了",
      },
    })
  }
  const bodyError = isBodyParseError(error)
  return reply.code(status).send({
    ok: false,
    error: {
      code: bodyError ? "bad_request" : error.code || "bad_request",
      message: bodyError ? "请求体格式不正确" : error.message || "请求失败",
    },
  })
}
