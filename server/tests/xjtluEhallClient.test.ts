import assert from "node:assert/strict";
import test from "node:test";

process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "xjtlu-ehall-test-secret";

test("XJTLU eHall exchanges the UIM session, isolates cookies, and exposes services", async (t) => {
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
    if (url.pathname === "/index.html") {
      return new Response("<html></html>");
    }
    if (url.pathname === "/getLoginUser") {
      assert.doesNotMatch(cookies, /UIM_SESSION/);
      assert.match(cookies, /EHALL_AUTH=ready/);
      return Response.json({
        errcode: "0",
        errmsg: "success",
        data: { userAccount: "Student.Name24", userName: "Test Student" },
      });
    }
    if (url.pathname === "/queryFolderAndService") {
      assert.equal(init.method, "POST");
      const payload = JSON.parse(String(init.body)) as { n?: string };
      assert.ok(payload.n);
      return Response.json({
        errcode: "0",
        data: [{
          folderName: "教学服务",
          services: [{
            serviceWid: "service-1",
            serviceName: "成绩单及证明申请",
            serviceDesc: "申请成绩单",
            departmentName: "教务办公室",
            iconLink: "https://ehall.xjtlu.edu.cn/icon.png",
            permission: true,
            favorite: true,
            serviceStation: 0,
          }],
        }],
      });
    }
    if (url.pathname === "/getPageView") {
      const pageCode = url.searchParams.get("pageCode");
      assert.ok(pageCode === "hall" || pageCode === "homeXS");
      return Response.json({
        errcode: "0",
        data: JSON.stringify({
          cards: pageCode === "hall"
            ? [{ cardId: "CUS_CARD_ALLSERVICEITEM", cardWid: "5221461526271929" }]
            : [{ cardId: "CUS_CARD_NEWSANNOUNCEMENT", cardWid: "7633185986201947" }],
        }),
      });
    }
    if (url.pathname === "/execCardMethod/5221461526271929/CUS_CARD_ALLSERVICEITEM") {
      assert.equal(init.method, "POST");
      const payload = JSON.parse(String(init.body)) as {
        method?: string;
        param?: { pageNumber?: number; pageSize?: number };
      };
      assert.equal(payload.method, "searchServiceItem");
      assert.equal(payload.param?.pageNumber, 1);
      assert.equal(payload.param?.pageSize, 500);
      return Response.json({
        errcode: "0",
        data: {
          total: 2,
          serviceItemList: [{
            itemWid: "item-1",
            itemName: "大型仪器共享管理系统",
            itemDesc: "在线办理事项",
            categoryName: "科研服务",
            deptName: "科研管理办公室",
            iconLink: "https://ehall.xjtlu.edu.cn/item-icon.png",
            isAuthorized: 1,
            onlineServiceType: 2,
            favorite: 0,
          }, {
            itemWid: "item-guide-1",
            itemName: "护理处置",
            itemDesc: "查看办事说明",
            categoryName: "校园服务",
            deptName: "学生事务中心",
            isAuthorized: 1,
            onlineServiceType: 0,
            isShow: 1,
          }],
        },
      });
    }
    if (url.pathname === "/execCardMethod/7633185986201947/CUS_CARD_NEWSANNOUNCEMENT") {
      assert.equal(init.method, "POST");
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
    if (url.pathname === "/simJump") {
      assert.equal(url.searchParams.get("id"), "item-1");
      assert.equal(url.searchParams.get("name"), "大型仪器共享管理系统");
      assert.match(cookies, /EHALL_AUTH=ready/);
      return new Response(null, {
        status: 302,
        headers: { Location: "https://service.xjtlu.edu.cn/item-start?ticket=item-one-time" },
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
  const status = await getXjtluEhallStatus(991);
  assert.deepEqual(status, { active: true, username: "student.name24", displayName: "Test Student" });
  const services = await getXjtluEhallServices(991);
  assert.equal(services.length, 3);
  assert.deepEqual(services[0], {
    id: "item-1",
    kind: "item",
    name: "大型仪器共享管理系统",
    description: "在线办理事项",
    category: "科研服务",
    department: "科研管理办公室",
    icon: "https://ehall.xjtlu.edu.cn/item-icon.png",
    favorite: false,
    permission: true,
    serviceStation: 0,
    online: true,
  });
  assert.deepEqual(services[1], {
    id: "item-guide-1",
    kind: "item",
    name: "护理处置",
    description: "查看办事说明",
    category: "校园服务",
    department: "学生事务中心",
    icon: "",
    favorite: false,
    permission: true,
    serviceStation: 0,
    online: false,
  });
  assert.deepEqual(services[2], {
    id: "service-1",
    kind: "service",
    name: "成绩单及证明申请",
    description: "申请成绩单",
    category: "教学服务",
    department: "教务办公室",
    icon: "https://ehall.xjtlu.edu.cn/icon.png",
    favorite: true,
    permission: true,
    serviceStation: 0,
    online: true,
  });
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
  assert.equal(
    await getXjtluEhallLaunchUrl(991, "item-guide-1"),
    "https://ehall.xjtlu.edu.cn/default/index.html#/itemDetail?wid=item-guide-1&name=%E6%8A%A4%E7%90%86%E5%A4%84%E7%BD%AE",
  );
  assert.equal(
    // 旧版前端只传 serviceId，后端仍应按办事事项打开。
    await getXjtluEhallLaunchUrl(991, "item-1"),
    "https://service.xjtlu.edu.cn/item-start?ticket=item-one-time",
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
