import express from "express";
import cors from "cors";
import morgan from "morgan";
import compression from "compression";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { errorHandler } from "./middleware/error";
import { router } from "./routes";
import { shareRouter } from "./routes/share";
import { config, isDev } from "./config";
import { getDatabaseMaintenanceMessage, isDatabaseMaintenanceActive } from "./services/maintenance";
import { filestoreProxy } from "./services/filestore";
import { uploadAssetHandler } from "./services/mediaStorage";
import { fail } from "./utils/response";
import {
  browserSessionMiddleware,
  corsOptionsForRequest,
  requestOriginAndCsrfProtection,
} from "./middleware/browserSession";
import { getSiteLogoUrl, getSiteName, getSiteSubtitle } from "./services/siteSettings";
import { requestObservability } from "./middleware/requestObservability";

export function createApp() {
  const app = express();

  // Direct deployments must not trust attacker-supplied X-Forwarded-For.
  // Set TRUST_PROXY_HOPS=1 when exactly one trusted reverse proxy fronts Node.
  app.set("trust proxy", config.trustProxyHops);
  app.use(requestObservability);
  app.use(cors((req, callback) => callback(null, corsOptionsForRequest(req))));
  app.use(compression({
    threshold: 1024,
  }));
  app.use((req, res, next) => {
    if (!isDatabaseMaintenanceActive()) return next();
    if (req.path === "/api/health") return next();
    return fail(res, 5030, getDatabaseMaintenanceMessage(), 503);
  });
  app.use("/filestore", browserSessionMiddleware, requestOriginAndCsrfProtection, filestoreProxy);
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false }));
  if (isDev) app.use(morgan("dev"));

  app.use("/api", browserSessionMiddleware, requestOriginAndCsrfProtection);
  app.use(["/api/auth", "/api/user", "/api/ehall", "/api/academic"], (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    next();
  });

  app.use("/uploads", uploadAssetHandler);

  app.get("/api/health", (_req, res) => {
    res.json({ code: 0, data: { ok: true, ts: Date.now() }, message: "" });
  });

  app.get("/10b0f912e73a202f7040913a82166673.txt", (_req, res) => {
    res.type("text/plain; charset=utf-8");
    res.send("9abfb616e9ac54f49df77561d1d73d364e38f9a4");
  });

  app.use("/share", shareRouter);
  app.use("/api", router);

  app.use("/api/*", (_req, res) => {
    res.status(404).json({ code: 4004, data: null, message: "接口不存在" });
  });

  // 生产模式：直接 serve 前端 dist（避免再起 nginx）
  if (!isDev) {
    // 候选 dist 路径（兼容从 server/ 或项目根启动）
    const candidates = [
      path.resolve(process.cwd(), "../web/dist"),
      path.resolve(process.cwd(), "web/dist"),
      path.resolve(__dirname, "../../web/dist"),
    ];
    const dist = candidates.find((p) => existsSync(p));
    if (dist) {
      console.log(`📦 静态资源目录: ${dist}`);
      app.get("/manifest-v3.webmanifest", (_req, res, next) => {
        try {
          const manifest = JSON.parse(readFileSync(path.join(dist, "manifest-v3.webmanifest"), "utf8"));
          const siteName = getSiteName();
          manifest.name = siteName;
          manifest.short_name = [...siteName].slice(0, 12).join("");
          manifest.description = getSiteSubtitle();
          const siteLogoUrl = getSiteLogoUrl();
          if (siteLogoUrl) manifest.icons = [{ src: siteLogoUrl, sizes: "any", purpose: "any" }];
          res.setHeader("Cache-Control", "no-cache");
          res.type("application/manifest+json").send(JSON.stringify(manifest));
        } catch (error) { next(error); }
      });
      app.use(express.static(dist, { maxAge: "7d", index: false }));
      // SPA fallback：非 /api 路径全部返回 index.html
      app.get(/^\/(?!api).*/, (_req, res) => {
        res.sendFile(path.join(dist, "index.html"));
      });
    } else {
      console.warn("⚠️  未找到 web/dist，前端可能未构建");
    }
  }

  app.use(errorHandler);
  return app;
}
