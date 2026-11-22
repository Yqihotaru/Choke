import type { FastifyError, FastifyReply, FastifyRequest } from "fastify"
import { ZodError } from "zod"

/** schema.parse() 抛的 ZodError 是客户端输入问题：回 400；其它错误交给 Fastify 默认处理。 */
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
  return reply.send(error)
}
