import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../utils/response";
import { ZodError } from "zod";
import { isDev } from "../config";
import { requestIdFromResponse } from "./requestObservability";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const anyErr = err as { type?: string; name?: string; code?: string; status?: number; statusCode?: number; message?: string } | undefined;
  if (
    anyErr?.type === "entity.too.large" ||
    anyErr?.status === 413 ||
    anyErr?.statusCode === 413
  ) {
    return res.status(413).json({
      code: 4013,
      data: null,
      message: "上传内容过大，请压缩图片或更换更小的文件后重试",
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ code: err.code, data: null, message: err.message });
  }
  if (err instanceof ZodError) {
    const msg = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    return res.status(400).json({ code: 4000, data: null, message: "参数错误：" + msg });
  }
  // Do not turn malformed numeric route/query input or common data conflicts
  // into opaque 500 responses. Keep Prisma's internal detail out of the API.
  if (anyErr?.name === "PrismaClientValidationError") {
    return res.status(400).json({ code: 4000, data: null, message: "请求参数格式不正确" });
  }
  if (anyErr?.code === "P2025") {
    return res.status(404).json({ code: 4004, data: null, message: "资源不存在或已被移除" });
  }
  if (["P2002", "P2003", "P2034"].includes(anyErr?.code || "")) {
    return res.status(409).json({ code: 4009, data: null, message: "数据已发生变化，请刷新后重试" });
  }
  const requestId = requestIdFromResponse(res);
  console.error(JSON.stringify({
    type: "request_error",
    requestId,
    method: req.method,
    path: req.path,
    errorName: anyErr?.name || "Error",
    errorCode: anyErr?.code || null,
    message: isDev ? String(anyErr?.message || "未知错误").slice(0, 500) : "internal_error",
  }));
  return res.status(500).json({ code: 5000, data: null, message: "服务器内部错误，请稍后再试" });
}
