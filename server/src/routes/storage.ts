import { Router } from "express";
import {
  completeAdminOneDriveChinaAuthorization,
  recordAdminOneDriveChinaAuthorizationError,
} from "../services/adminStorageService";
import { getSiteOrigin } from "../services/siteSettings";

export const storageRouter = Router();

storageRouter.get("/onedrive-cn/callback", async (req, res) => {
  const oauthError = String(req.query.error || "").trim();
  const oauthErrorDescription = String(req.query.error_description || "").trim();
  const state = String(req.query.state || "").trim();
  if (oauthError) {
    let message = cleanCallbackMessage(
      oauthErrorDescription || oauthError
        || "用户取消了世纪互联 OneDrive 授权",
    );
    try {
      await recordAdminOneDriveChinaAuthorizationError(state, message);
    } catch (error) {
      message = cleanCallbackMessage(
        error instanceof Error ? error.message : "授权状态无效",
      );
    }
    res.redirect(302, adminStorageRedirect("error", message));
    return;
  }

  const code = String(req.query.code || "").trim();
  if (!code || !state) {
    const message = "世纪互联 OneDrive 授权回调缺少 code 或 state";
    if (state) {
      await recordAdminOneDriveChinaAuthorizationError(
        state,
        message,
      ).catch(() => null);
    }
    res.redirect(302, adminStorageRedirect("error", message));
    return;
  }

  try {
    await completeAdminOneDriveChinaAuthorization({ code, state });
    res.redirect(302, adminStorageRedirect("success"));
  } catch (error) {
    const message = cleanCallbackMessage(
      error instanceof Error
        ? error.message
        : "世纪互联 OneDrive 授权失败",
    );
    await recordAdminOneDriveChinaAuthorizationError(
      state,
      message,
    ).catch(() => null);
    res.redirect(302, adminStorageRedirect("error", message));
  }
});

function cleanCallbackMessage(input: string) {
  return String(input || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 300);
}

function adminStorageRedirect(
  status: "success" | "error",
  message = "",
) {
  const query = new URLSearchParams({
    tab: "media-storage",
    storageAuth: status,
  });
  if (message) query.set("storageAuthMessage", message);
  const configuredOrigin = getSiteOrigin().replace(/\/+$/, "");
  const path = `/admin?${query.toString()}`;
  return configuredOrigin ? `${configuredOrigin}${path}` : path;
}
