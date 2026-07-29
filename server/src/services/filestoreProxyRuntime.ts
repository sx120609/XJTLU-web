import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import type { Request, Response } from "express";
import { config } from "../config";

export const FILESTORE_MOUNT_PATH = "/filestore";

const TEXT_RESPONSE_RE =
  /^(text\/|application\/json\b|application\/javascript\b|text\/javascript\b)/i;
const TRUSTED_PROXY_TOKEN =
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

let filestoreProcess: ChildProcess | null = null;
let startupPromise: Promise<void> | null = null;

export type FilestoreProxyUser = {
  userId: number;
  username: string;
  nickname: string;
  role: string;
  isToolManager: boolean;
};

function filestoreRoot() {
  const candidates = [
    path.resolve(process.cwd(), "filestore"),
    path.resolve(process.cwd(), "server", "filestore"),
    path.resolve(__dirname, "../../filestore"),
  ];
  const root = candidates.find((candidate) =>
    existsSync(path.join(candidate, "app.py"))
  );
  if (!root) throw new Error("未找到 server/filestore/app.py");
  return root;
}

function pythonCommand() {
  if (config.filestorePython) {
    return { command: config.filestorePython, args: [] as string[] };
  }
  if (process.platform === "win32") {
    return { command: "python", args: [] as string[] };
  }
  return { command: "python3", args: [] as string[] };
}

function requestStatus(targetPath: string) {
  return new Promise<number>((resolve) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: config.filestorePort,
        path: targetPath,
        method: "GET",
        timeout: 800,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on("timeout", () => {
      request.destroy();
      resolve(0);
    });
    request.on("error", () => resolve(0));
    request.end();
  });
}

async function healthCheck() {
  const status = await requestStatus("/api/health");
  return status >= 200 && status < 500;
}

async function waitForHealth(timeoutMs = 7000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await healthCheck()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Filestore 未能在 ${timeoutMs}ms 内启动`);
}

async function stopUnhealthyFilestoreProcess() {
  const child = filestoreProcess;
  if (!child || child.exitCode !== null || child.killed) return;

  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      child.off("exit", finish);
      child.off("error", finish);
      resolve();
    };
    const timeout = setTimeout(finish, 1000);
    child.once("exit", finish);
    child.once("error", finish);
    child.kill();
  });
  if (filestoreProcess === child) filestoreProcess = null;
}

async function startFilestoreProcess() {
  await stopUnhealthyFilestoreProcess();

  const root = filestoreRoot();
  const python = pythonCommand();
  const child = spawn(python.command, [...python.args, "app.py"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(config.filestorePort),
      FILESTORE_TRUSTED_PROXY_TOKEN: TRUSTED_PROXY_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  filestoreProcess = child;

  child.stdout?.on("data", (data) => {
    String(data)
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => console.log(`[filestore] ${line}`));
  });
  child.stderr?.on("data", (data) => {
    String(data)
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => console.warn(`[filestore] ${line}`));
  });
  child.on("error", (error) => {
    console.warn(`[filestore] 子进程启动失败: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    if (filestoreProcess === child) filestoreProcess = null;
    if (code !== 0 && signal !== "SIGTERM") {
      console.warn(
        `Filestore 已退出: code=${code} signal=${signal ?? ""}`,
      );
    }
  });

  try {
    await waitForHealth();
  } catch (error) {
    if (filestoreProcess === child) filestoreProcess = null;
    if (child.exitCode === null && !child.killed) child.kill();
    throw error;
  }
}

export async function ensureFilestoreStarted() {
  if (!config.filestoreEnabled) {
    throw new Error("Filestore 已通过 FILESTORE_ENABLED=false 禁用");
  }
  if (await healthCheck()) return;
  if (startupPromise) return startupPromise;

  const pending = startFilestoreProcess();
  startupPromise = pending;
  try {
    await pending;
  } finally {
    if (startupPromise === pending) startupPromise = null;
  }
}

export function filestoreUpstreamPath(req: Request) {
  const original = req.originalUrl || req.url || "/";
  const withoutMount =
    original.replace(
      new RegExp(`^${FILESTORE_MOUNT_PATH}(?=/|$)`),
      "",
    ) || "/";
  return withoutMount.startsWith("/") ? withoutMount : `/${withoutMount}`;
}

function encodeFilestoreHeaderValue(value?: string | null) {
  return encodeURIComponent(String(value ?? ""));
}

export function rewriteFilestoreProxyText(body: string) {
  return body
    .replace(
      /((?:href|src)=["'])\/(styles\.css|admin\.js|submit\.js|status\.js)(["'])/g,
      `$1${FILESTORE_MOUNT_PATH}/$2$3`,
    )
    .replace(/(["'`])\/api\//g, `$1${FILESTORE_MOUNT_PATH}/api/`)
    .replace(/(["'`])\/submit\//g, `$1${FILESTORE_MOUNT_PATH}/submit/`)
    .replace(/(["'`])\/status\//g, `$1${FILESTORE_MOUNT_PATH}/status/`)
    .replace(
      /\$\{base\}\/status\//g,
      `\${base}${FILESTORE_MOUNT_PATH}/status/`,
    )
    .replace(
      /\$\{base\}\/submit\//g,
      `\${base}${FILESTORE_MOUNT_PATH}/submit/`,
    );
}

export function rewriteFilestoreProxyHeaderValue(
  name: string,
  value: number | string | string[],
): string | string[] {
  if (Array.isArray(value)) {
    return value.map((item) =>
      String(rewriteFilestoreProxyHeaderValue(name, item))
    );
  }
  const text = String(value);
  if (name.toLowerCase() === "set-cookie") {
    return text.replace(
      /;\s*Path=\//i,
      `; Path=${FILESTORE_MOUNT_PATH}`,
    );
  }
  if (name.toLowerCase() === "location" && text.startsWith("/")) {
    return `${FILESTORE_MOUNT_PATH}${text}`;
  }
  return text;
}

function writeHeaders(
  res: Response,
  upstream: http.IncomingMessage,
  rewrittenBody?: Buffer,
) {
  res.status(upstream.statusCode ?? 502);
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (value === undefined || name.toLowerCase() === "connection") continue;
    if (rewrittenBody && name.toLowerCase() === "content-length") continue;
    res.setHeader(name, rewriteFilestoreProxyHeaderValue(name, value));
  }
  if (rewrittenBody) {
    res.setHeader("content-length", String(rewrittenBody.byteLength));
  }
}

export function proxyToFilestore(
  req: Request,
  res: Response,
  user: FilestoreProxyUser | null,
) {
  const headers = {
    ...req.headers,
    host: `127.0.0.1:${config.filestorePort}`,
    "x-cpu-filestore-admin": TRUSTED_PROXY_TOKEN,
    ...(user
      ? {
          "x-cpu-filestore-user-id": String(user.userId),
          "x-cpu-filestore-username": encodeFilestoreHeaderValue(
            user.username,
          ),
          "x-cpu-filestore-display-name": encodeFilestoreHeaderValue(
            user.nickname || user.username,
          ),
          "x-cpu-filestore-role": user.role,
          "x-cpu-filestore-is-manager": user.isToolManager ? "1" : "0",
        }
      : {}),
  };
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: config.filestorePort,
      path: filestoreUpstreamPath(req),
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      const contentType = String(
        upstreamRes.headers["content-type"] ?? "",
      );
      if (!TEXT_RESPONSE_RE.test(contentType)) {
        writeHeaders(res, upstreamRes);
        upstreamRes.pipe(res);
        return;
      }

      const chunks: Buffer[] = [];
      upstreamRes.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      upstreamRes.on("end", () => {
        const source = Buffer.concat(chunks).toString("utf8");
        const body = Buffer.from(rewriteFilestoreProxyText(source), "utf8");
        writeHeaders(res, upstreamRes, body);
        res.end(body);
      });
    },
  );

  upstream.on("error", (error) => {
    if (!res.headersSent) {
      res.status(502).send(`Filestore 代理失败：${error.message}`);
    } else {
      res.end();
    }
  });
  req.pipe(upstream);
}
