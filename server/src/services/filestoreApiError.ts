import type { Response } from "express";

export class FilestoreApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public payload?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function filestoreApiError(
  status: number,
  message: string,
  payload?: Record<string, unknown>,
) {
  return new FilestoreApiError(status, message, payload);
}

export function sendFilestoreApiError(res: Response, error: unknown) {
  const status = error instanceof FilestoreApiError ? error.status : 500;
  const message = error instanceof Error ? error.message : "请求失败";
  if (error instanceof FilestoreApiError && error.payload) {
    res.status(status).json({ error: message, ...error.payload });
    return;
  }
  res.status(status).json({ error: message });
}
