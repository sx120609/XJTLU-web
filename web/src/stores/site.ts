import { defineStore } from "pinia";
import { siteApi, type FeatureMap, type PublicSiteConfig } from "@/api/site";

export const DEFAULT_SITE_NAME = "XJTLU 校园服务";

function applySiteIdentity(siteName: string) {
  if (typeof document === "undefined") return;
  const name = siteName || DEFAULT_SITE_NAME;
  document.querySelectorAll<HTMLMetaElement>('meta[name="application-name"], meta[name="apple-mobile-web-app-title"]')
    .forEach((meta) => meta.setAttribute("content", name));
  const launchTitle = document.querySelector<HTMLElement>(".app-launch-title");
  if (launchTitle) launchTitle.textContent = name;
  const launchScreen = document.querySelector<HTMLElement>(".app-launch-screen");
  if (launchScreen) launchScreen.setAttribute("aria-label", `${name}正在启动`);
  if (document.title.includes(" · ")) {
    document.title = `${document.title.split(" · ")[0]} · ${name}`;
  }
}

function applySiteSubtitle(siteSubtitle: string) {
  if (typeof document === "undefined") return;
  const launchSubtitle = document.querySelector<HTMLElement>(".app-launch-subtitle");
  if (launchSubtitle) launchSubtitle.textContent = siteSubtitle || "西交利物浦校园互助服务";
}

function applySiteLogo(siteLogoUrl: string) {
  if (typeof document === "undefined") return;
  const launchLogo = document.querySelector<HTMLImageElement>(".app-launch-logo");
  if (launchLogo) {
    if (!launchLogo.dataset.defaultSrc) launchLogo.dataset.defaultSrc = launchLogo.src;
    launchLogo.src = siteLogoUrl || launchLogo.dataset.defaultSrc || "/apple-touch-icon-v3.png?v=20260530-hw";
  }
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]')
    .forEach((link) => {
      if (!link.dataset.defaultHref) link.dataset.defaultHref = link.href;
      link.href = siteLogoUrl || link.dataset.defaultHref || link.href;
    });
}

/**
 * 站点级开关：默认关闭可选功能，拉到后台真实开关后再展示入口。
 * 避免接口返回前短暂露出未开放功能。
 */
export const useSiteStore = defineStore("site", {
  state: () => ({
    siteName: DEFAULT_SITE_NAME,
    siteSubtitle: "西交利物浦校园互助服务",
    siteLogoUrl: "",
    features: { forum: false, market: false, coursereview: false, electric: false, sponsor: false } as FeatureMap,
    siteOrigin: "",
    siteFilingNumber: "",
    loaded: false,
    loading: false,
    _pendingFetch: null as Promise<void> | null,
  }),
  actions: {
    async fetch(force = false) {
      if (this._pendingFetch) return this._pendingFetch;
      if (this.loaded && !force) return;
      this.loading = true;
      const task = (async () => {
        try {
          const [featureResult, configResult] = await Promise.allSettled([
            siteApi.features(),
            siteApi.config(),
          ]);
          if (featureResult.status === "fulfilled") {
            this.features = featureResult.value;
          }
          if (configResult.status === "fulfilled") {
            this.siteName = configResult.value.siteName || DEFAULT_SITE_NAME;
            this.siteSubtitle = configResult.value.siteSubtitle || "西交利物浦校园互助服务";
            this.siteLogoUrl = configResult.value.siteLogoUrl || "";
            this.siteOrigin = configResult.value.siteOrigin || "";
            this.siteFilingNumber = configResult.value.siteFilingNumber || "";
            applySiteIdentity(this.siteName);
            applySiteSubtitle(this.siteSubtitle);
            applySiteLogo(this.siteLogoUrl);
          }
        } catch {
          // 接口失败：维持默认关闭可选功能，避免误展示后台未开放入口。
        } finally {
          this.loaded = true;
          this.loading = false;
          this._pendingFetch = null;
        }
      })();
      this._pendingFetch = task;
      return task;
    },
    /** admin PATCH /admin/features 成功后调一次更新本地状态 */
    apply(map: FeatureMap) {
      this.features = map;
    },
    applyConfig(config: Partial<PublicSiteConfig>) {
      if (config.siteName !== undefined) this.siteName = config.siteName || DEFAULT_SITE_NAME;
      if (config.siteSubtitle !== undefined) this.siteSubtitle = config.siteSubtitle || "西交利物浦校园互助服务";
      if (config.siteLogoUrl !== undefined) this.siteLogoUrl = config.siteLogoUrl || "";
      if (config.siteOrigin !== undefined) this.siteOrigin = config.siteOrigin || "";
      if (config.siteFilingNumber !== undefined) this.siteFilingNumber = config.siteFilingNumber || "";
      applySiteIdentity(this.siteName);
      applySiteSubtitle(this.siteSubtitle);
      applySiteLogo(this.siteLogoUrl);
    },
  },
});
