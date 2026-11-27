import type { FastifyError, FastifyReply, FastifyRequest } from "fastify"
import { ZodError } from "zod"

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
  return reply.code(status).send({
    ok: false,
    error: {
      code: error.code || "bad_request",
      message: error.message || "请求失败",
    },
  })
}
