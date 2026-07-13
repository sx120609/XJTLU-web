import assert from "node:assert/strict";
import test from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "xjtlu-ehall-test-secret";

test("XJTLU eHall mirrors the official apps catalog and launches listed apps", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const seen: string[] = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const cookies = headers.get("Cookie") || "";
    seen.push(`${init.method || "GET"} ${url.origin}${url.pathname}`);
    assert.equal(init.redirect, "manual");

    if (url.origin === "https://ehall.xjtlu.edu.cn" && url.pathname === "/auth-protocol-core/login") {
      assert.doesNotMatch(cookies, /UIM_SESSION/);
      return new Response(null, {
        status: 302,
        headers: {
          Location: "https://sso.xjtlu.edu.cn/esc-sso/oauth2.0/authorize?client_id=test&response_type=code&redirect_uri=https%3A%2F%2Fehall.xjtlu.edu.cn%2Fauth-protocol-core%2FloginSuccess%3FsessionToken%3Dtest",
          "Set-Cookie": "JSESSIONID=ehall-auth; Path=/auth-protocol-core; Secure; HttpOnly",
        },
      });
    }
    if (url.origin === "https://sso.xjtlu.edu.cn") {
      assert.equal(cookies, "");
      return new Response(null, {
        status: 302,
        headers: { Location: url.toString().replace("https://sso.xjtlu.edu.cn", "https://uim.xjtlu.edu.cn") },
      });
    }
    if (url.origin === "https://uim.xjtlu.edu.cn") {
      assert.match(cookies, /UIM_SESSION=authenticated/);
      return new Response(null, {
        status: 302,
        headers: { Location: "https://ehall.xjtlu.edu.cn/auth-protocol-core/loginSuccess?sessionToken=test&code=oauth-code" },
      });
    }
    if (url.pathname === "/auth-protocol-core/loginSuccess") {
      assert.match(cookies, /JSESSIONID=ehall-auth/);
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/login",
          "Set-Cookie": "EHALL_AUTH=ready; Path=/; Secure; HttpOnly",
        },
      });
    }
    if (url.pathname === "/login") {
      assert.match(cookies, /EHALL_AUTH=ready/);
      return new Response(null, { status: 302, headers: { Location: "/index.html" } });
    }
    if (url.pathname === "/index.html") return new Response("<html></html>");
    if (url.pathname === "/getLoginUser") {
      assert.doesNotMatch(cookies, /UIM_SESSION/);
      assert.match(cookies, /EHALL_AUTH=ready/);
      return Response.json({
        errcode: "0",
        errmsg: "success",
        data: { userAccount: "Student.Name24", userName: "Test Student" },
      });
    }
    if (url.pathname === "/getPageView") {
      const pageCode = url.searchParams.get("pageCode");
      assert.ok(pageCode === "apps" || pageCode === "homeXS");
      return Response.json({
        errcode: "0",
        data: JSON.stringify({
          cards: pageCode === "apps"
            ? [{ cardId: "CUS_CARD_ALLSERVICE", cardWid: "36671875738857906", cardName: "全部服务" }]
            : [{ cardId: "CUS_CARD_NEWSANNOUNCEMENT", cardWid: "7633185986201947" }],
        }),
      });
    }
    if (url.pathname === "/execCardMethod/36671875738857906/CUS_CARD_ALLSERVICE") {
      const payload = JSON.parse(String(init.body)) as {
        method?: string;
        param?: { fromMaster?: boolean; lang?: string };
      };
      assert.equal(payload.method, "renderData");
      assert.equal(payload.param?.fromMaster, true);
      assert.equal(payload.param?.lang, "zh_CN");
      return Response.json({
        errcode: "0",
        data: {
          serviceList: [{
            navName: "学术教育及科研",
            classifyWid: "category-1",
            datas: [{
              serviceWid: "service-1",
              serviceName: "西浦学习超市Core",
              serviceDesc: "在线学习平台",
              iconLink: "https://ehall.xjtlu.edu.cn/icon.png",
              permission: true,
              favorite: true,
              serviceStation: 2,
            }, {
              serviceWid: "service-2",
              serviceName: "e-Bridge",
              serviceDesc: "学生和课程信息管理系统",
              permission: true,
              serviceStation: 2,
            }],
          }, {
            navName: "校园生活",
            classifyWid: "category-2",
            datas: [{
              serviceWid: "service-3",
              serviceName: "校车查询系统",
              serviceDesc: "查询校车时刻",
              permission: true,
              serviceStation: 2,
            }],
          }],
        },
      });
    }
    if (url.pathname === "/execCardMethod/7633185986201947/CUS_CARD_NEWSANNOUNCEMENT") {
      const payload = JSON.parse(String(init.body)) as {
        method?: string;
        param?: { channelIds?: string; programIds?: string; pageNumber?: number };
      };
      if (payload.method === "getConfiguredAndSubscribedChannel") {
        return Response.json({
          errcode: "0",
          data: {
            configuredChannel: [{ id: "notice-channel", name: "通知", type: 0 }],
            subscribedChannel: [{ wid: "notice-channel", name: "通知", type: 0 }],
          },
        });
      }
      assert.equal(payload.method, "getChannelNews");
      assert.equal(payload.param?.channelIds, "notice-channel");
      assert.equal(payload.param?.programIds, "");
      assert.ok(payload.param?.pageNumber === 1 || payload.param?.pageNumber === 2);
      const secondPage = payload.param?.pageNumber === 2;
      return Response.json({
        errcode: "0",
        data: {
          datas: {
            totalSize: 2,
            pageSize: 1,
            data: [{
              wid: secondPage ? "183650" : "183664",
              title: secondPage ? "Notice of Power Outage" : "Notice of Temporary Closure of Life Hope (North)",
              pubTime: secondPage ? "2026/06/16 16:38" : "2026/06/23 16:35",
              author: "UniversityCommunications",
              channelName: "通知",
              sideFlag: 1,
              url: `https://intranet.xjtlu.edu.cn/spa/document/index.jsp?id=${secondPage ? "183650" : "183664"}&code=test-code`,
            }],
          },
        },
      });
    }
    if (url.pathname === "/serviceShow") {
      assert.equal(url.searchParams.get("serviceId"), "service-1");
      return Response.json({
        errcode: "0",
        data: { grantData: [{ serviceUrl: "https://service.xjtlu.edu.cn/start?ticket=one-time" }] },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const {
    clearXjtluEhallSession,
    establishXjtluEhallSession,
    getXjtluEhallLaunchUrl,
    getXjtluEhallNotices,
    getXjtluEhallServices,
    getXjtluEhallStatus,
  } = await import("../src/services/xjtluEhallClient");

  await establishXjtluEhallSession(991, "student.name24", { UIM_SESSION: "authenticated" });
  assert.deepEqual(
    await getXjtluEhallStatus(991),
    { active: true, username: "student.name24", displayName: "Test Student" },
  );
  assert.deepEqual(await getXjtluEhallServices(991), [{
    id: "service-1",
    kind: "service",
    name: "西浦学习超市Core",
    description: "在线学习平台",
    category: "学术教育及科研",
    department: "",
    icon: "https://ehall.xjtlu.edu.cn/icon.png",
    favorite: true,
    permission: true,
    serviceStation: 2,
    online: true,
    featuredRank: 0,
  }, {
    id: "service-2",
    kind: "service",
    name: "e-Bridge",
    description: "学生和课程信息管理系统",
    category: "学术教育及科研",
    department: "",
    icon: "",
    favorite: false,
    permission: true,
    serviceStation: 2,
    online: true,
    featuredRank: 1,
  }, {
    id: "service-3",
    kind: "service",
    name: "校车查询系统",
    description: "查询校车时刻",
    category: "校园生活",
    department: "",
    icon: "",
    favorite: false,
    permission: true,
    serviceStation: 2,
    online: true,
    featuredRank: null,
  }]);
  assert.deepEqual(await getXjtluEhallNotices(991), {
    active: true,
    notices: [{
      id: "183664",
      title: "Notice of Temporary Closure of Life Hope (North)",
      publishedAt: "2026/06/23 16:35",
      author: "UniversityCommunications",
      category: "通知",
      url: "https://intranet.xjtlu.edu.cn/spa/document/index.jsp?id=183664&code=test-code",
    }, {
      id: "183650",
      title: "Notice of Power Outage",
      publishedAt: "2026/06/16 16:38",
      author: "UniversityCommunications",
      category: "通知",
      url: "https://intranet.xjtlu.edu.cn/spa/document/index.jsp?id=183650&code=test-code",
    }],
  });
  assert.equal(
    await getXjtluEhallLaunchUrl(991, "service-1", "service"),
    "https://service.xjtlu.edu.cn/start?ticket=one-time",
  );
  await assert.rejects(
    () => getXjtluEhallLaunchUrl(991, "not-in-catalog", "service"),
    /无权访问/,
  );
  assert.ok(seen.includes("GET https://uim.xjtlu.edu.cn/esc-sso/oauth2.0/authorize"));
  await clearXjtluEhallSession(991);
  assert.deepEqual(await getXjtluEhallStatus(991), { active: false });
});

test("XJTLU eHall rejects OAuth redirects outside the strict allowlist", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response(null, {
    status: 302,
    headers: { Location: "https://attacker.example/steal" },
  });
  const { establishXjtluEhallSession } = await import("../src/services/xjtluEhallClient");
  await assert.rejects(
    () => establishXjtluEhallSession(992, "student.name24", { UIM_SESSION: "authenticated" }),
    /非预期跳转/,
  );
});
