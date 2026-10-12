import type { FastifyReply, FastifyRequest } from "fastify";

export function sendAskProblem(
  req: FastifyRequest,
  reply: FastifyReply,
  p: { status: number; code: string; detail: string },
) {
  return reply
    .code(p.status)
    .header("Content-Type", "application/problem+json")
    .header("Cache-Control", "no-store")
    .header("X-Request-Id", req.id)
    .send({
      type: `/problems/${p.code.replace(/_/g, "-")}`,
      title: p.status === 404 ? "Not found" : p.status === 409 ? "Conflict" : p.status === 400 ? "Bad request" : "Error",
      status: p.status,
      detail: p.detail,
      code: p.code,
      requestId: req.id,
    });
}
