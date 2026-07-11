import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

process.env.REDIS_ENABLED = "false";

test("XJTLU SSO fetches a fresh key, encrypts the password, and accepts a trusted redirect", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const seenUrls: string[] = [];
  let loginMode: "success" | "image-challenge" | "slider-challenge" | "untrusted-redirect" = "success";
  let untrustedRedirect = "https://attacker.example/login";

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    seenUrls.push(url);
    assert.equal(init.redirect, "manual");
    if (url.endsWith("/esc-sso/login/page")) {
      const headers = new Headers();
      headers.append("Set-Cookie", "ssoBrowserId=test-browser; Path=/esc-sso; HttpOnly");
      headers.append("Set-Cookie", "SESSION=first-session; Path=/; Secure; HttpOnly");
      return new Response("<html></html>", {
        status: 200,
        headers,
      });
    }
    if (url.endsWith("/esc-sso/api/v3/auth/policy")) {
      const requestHeaders = new Headers(init.headers);
      assert.match(requestHeaders.get("Cookie") ?? "", /ssoBrowserId=test-browser/);
      assert.match(requestHeaders.get("Cookie") ?? "", /SESSION=first-session/);
      const headers = new Headers();
      headers.append("Set-Cookie", "SESSION=rotated-session; Path=/; Secure; HttpOnly");
      return Response.json({
        code: "0",
        data: { param: { publicKey: publicKeyDer, publicKeyId: "test-key-id" } },
      }, { headers });
    }
    if (url.endsWith("/esc-sso/api/v3/auth/doLogin")) {
      const requestHeaders = new Headers(init.headers);
      assert.match(requestHeaders.get("Cookie") ?? "", /ssoBrowserId=test-browser/);
      assert.match(requestHeaders.get("Cookie") ?? "", /SESSION=rotated-session/);
      assert.doesNotMatch(requestHeaders.get("Cookie") ?? "", /SESSION=first-session/);
      assert.equal(requestHeaders.get("Origin"), "https://uim.xjtlu.edu.cn");
      assert.equal(requestHeaders.get("Referer"), "https://uim.xjtlu.edu.cn/esc-sso/login/page");
      assert.match(requestHeaders.get("Content-Type") ?? "", /^application\/json/);
      const payload = JSON.parse(String(init.body)) as {
        authType: string;
        dataField: { username: string; password: string; publicKeyId: string; vcode?: string };
      };
      assert.equal(payload.authType, "webLocalAuth");
      assert.equal(payload.dataField.username, "student.name24");
      assert.equal(payload.dataField.publicKeyId, "test-key-id");
      const decrypted = crypto.privateDecrypt(
        { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
        Buffer.from(payload.dataField.password, "base64"),
      ).toString("utf8");
      assert.equal(decrypted, "local-test-password");
      if (loginMode === "image-challenge" && payload.dataField.vcode !== "1234") {
        return Response.json({ code: "SSO10093", msg: "need image verification" });
      }
      if (loginMode === "slider-challenge" && payload.dataField.vcode !== "verified-slider-token") {
        return Response.json({ code: "SSO10094", msg: "need slider verification" });
      }
      if (loginMode === "untrusted-redirect") {
        return Response.json({ code: "0", data: { redirect: untrustedRedirect } });
      }
      return Response.json({
        code: "0",
        msg: "success",
        data: { redirect: "/esc-sso/login" },
      });
    }
    if (url.endsWith("/esc-sso/login")) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/selfcare/" },
      });
    }
    if (url.includes("/esc-sso/api/v1/image/getRandcode")) {
      return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }
    if (url.endsWith("/esc-sso/api/v3/sliderCaptcha/init")) {
      return Response.json({
        code: "0",
        data: { sourceImage: "c291cmNl", newImage: "cHV6emxl", Y: 28, token: "slider-token" },
      });
    }
    if (url.includes("/esc-sso/api/v3/sliderCaptcha/check")) {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("token"), "slider-token");
      return Response.json({ code: "0", data: "verified-slider-token" });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const {
    beginXjtluLogin,
    checkXjtluSlider,
    getXjtluPortalConnectionStatus,
    startXjtluLoginSessionFinalize,
    submitXjtluLogin,
  } = await import("../src/services/xjtluSsoClient");

  const requestsBeforeMobileAlias = seenUrls.length;
  const mobileAlias = await submitXjtluLogin({
    pendingId: "a".repeat(48),
    username: "13800138000",
    password: "local-test-password",
  });
  assert.equal(mobileAlias.ok, false);
  assert.match(mobileAlias.error ?? "", /XJTLU 用户名/);
  assert.equal(seenUrls.length, requestsBeforeMobileAlias);

  let invalidPendingHookCalls = 0;
  const invalidPending = await submitXjtluLogin({
    pendingId: "b".repeat(48),
    username: "student.name24",
    password: "local-test-password",
    beforeAuthenticate: async () => { invalidPendingHookCalls += 1; },
  });
  assert.equal(invalidPending.ok, false);
  assert.equal(invalidPendingHookCalls, 0);

  const begin = await beginXjtluLogin();
  assert.match(begin.pendingId, /^[a-f0-9]{48}$/);
  assert.equal(begin.needCaptcha, false);

  const result = await submitXjtluLogin({
    pendingId: begin.pendingId,
    username: "student.name24",
    password: "local-test-password",
  });
  assert.deepEqual(result, { ok: true, username: "student.name24" });
  assert.equal(seenUrls.length, 4);

  const replay = await submitXjtluLogin({
    pendingId: begin.pendingId,
    username: "student.name24",
    password: "local-test-password",
  });
  assert.equal(replay.ok, false);
  assert.match(replay.error ?? "", /过期/);

  loginMode = "image-challenge";
  const challengeBegin = await beginXjtluLogin();
  const challenge = await submitXjtluLogin({
    pendingId: challengeBegin.pendingId,
    username: "student.name24",
    password: "local-test-password",
  });
  assert.equal(challenge.ok, false);
  assert.equal(challenge.needVerification, true);
  assert.equal(challenge.verification?.type, "image");
  if (challenge.verification?.type !== "image") assert.fail("expected image challenge");
  assert.match(challenge.verification.image, /^data:image\/png;base64,/);
  const imageVerified = await submitXjtluLogin({
    pendingId: challengeBegin.pendingId,
    username: "student.name24",
    password: "local-test-password",
    verificationToken: "1234",
  });
  assert.equal(imageVerified.ok, true);

  loginMode = "slider-challenge";
  const sliderBegin = await beginXjtluLogin();
  const sliderChallenge = await submitXjtluLogin({
    pendingId: sliderBegin.pendingId,
    username: "student.name24",
    password: "local-test-password",
  });
  assert.equal(sliderChallenge.needVerification, true);
  assert.equal(sliderChallenge.verification?.type, "slider");
  if (sliderChallenge.verification?.type !== "slider") assert.fail("expected slider challenge");
  const sliderCheck = await checkXjtluSlider({
    pendingId: sliderBegin.pendingId,
    x: 88,
    y: sliderChallenge.verification.y,
    token: sliderChallenge.verification.token,
  });
  assert.equal(sliderCheck.ok, true);
  if (!sliderCheck.ok) assert.fail("expected slider check to pass");
  const sliderVerified = await submitXjtluLogin({
    pendingId: sliderBegin.pendingId,
    username: "student.name24",
    password: "local-test-password",
    verificationToken: sliderCheck.verificationToken,
  });
  assert.equal(sliderVerified.ok, true);

  loginMode = "untrusted-redirect";
  for (const redirect of [
    "not-a-url",
    "https://uim.xjtlu.edu.cn:444/selfcare/",
    "https://uim.xjtlu.edu.cn.attacker.example/selfcare/",
  ]) {
    untrustedRedirect = redirect;
    const untrustedBegin = await beginXjtluLogin();
    const untrusted = await submitXjtluLogin({
      pendingId: untrustedBegin.pendingId,
      username: "student.name24",
      password: "local-test-password",
    });
    assert.equal(untrusted.ok, false);
    assert.match(untrusted.error ?? "", /可信/);
  }

  loginMode = "success";
  const backgroundBegin = await beginXjtluLogin();
  const backgroundLogin = await submitXjtluLogin({
    pendingId: backgroundBegin.pendingId,
    username: "student.name24",
    password: "local-test-password",
  });
  assert.equal(backgroundLogin.ok, true);
  const backgroundStartedAt = Date.now();
  startXjtluLoginSessionFinalize({
    pendingId: backgroundBegin.pendingId,
    userId: 7788,
    username: "student.name24",
  });
  assert.ok(Date.now() - backgroundStartedAt < 50, "portal connection must not block the site login response");
  let portalStatus = await getXjtluPortalConnectionStatus(7788);
  for (let attempt = 0; attempt < 30 && portalStatus.ehall !== "failed"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    portalStatus = await getXjtluPortalConnectionStatus(7788);
  }
  assert.deepEqual({ ehall: portalStatus.ehall, ebridge: portalStatus.ebridge }, {
    ehall: "failed",
    ebridge: "failed",
  });
});

test("XJTLU SSO pauses at official MFA and verifies Email, OTP, and SMS methods", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  let emailSends = 0;
  let smsSends = 0;
  const submittedMfaTypes: string[] = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(init.redirect, "manual");

    if (url.pathname === "/esc-sso/login/page") {
      return new Response("<html></html>", {
        status: 200,
        headers: { "Set-Cookie": "SESSION=mfa-session; Path=/; Secure; HttpOnly" },
      });
    }
    if (url.pathname === "/esc-sso/api/v3/auth/policy") {
      return Response.json({
        code: "0",
        data: { param: { publicKey: publicKeyDer, publicKeyId: "primary-key" } },
      });
    }
    if (url.pathname === "/esc-sso/api/v3/auth/doLogin") {
      const payload = JSON.parse(String(init.body)) as {
        authType: string;
        dataField: Record<string, string>;
        redirectUri?: string;
      };
      if (payload.authType === "webLocalAuth") {
        return Response.json({ code: "0", data: { redirect: "/esc-sso/login" } });
      }

      submittedMfaTypes.push(payload.authType);
      assert.equal(payload.dataField.username, "student.name24");
      assert.equal(payload.redirectUri, "");
      assert.equal(new Headers(init.headers).get("Referer"), "https://uim.xjtlu.edu.cn/login/mfaLogin.html");
      if (payload.authType === "webExtendEmailCodeAuth") {
        assert.equal(payload.dataField.smsCode, "111111");
        return Response.json({ code: "MFA0001", msg: "invalid email code" });
      }
      if (payload.authType === "webSmsAuth") {
        assert.equal(payload.dataField.smsCode, "222222");
        return Response.json({ code: "MFA0001", msg: "invalid sms code" });
      }
      assert.equal(payload.authType, "webOtpAuth");
      assert.equal(payload.dataField.otp, "654321");
      assert.equal(payload.dataField.password, "");
      return Response.json({ code: "0", data: { redirect: "/selfcare/" } });
    }
    if (url.pathname === "/esc-sso/login") {
      return new Response(null, { status: 302, headers: { Location: "/ngw/login" } });
    }
    if (url.pathname === "/ngw/login") {
      return new Response(null, {
        status: 302,
        headers: { Location: "/esc-sso/oauth2.0/authorize?client_id=selfcare" },
      });
    }
    if (url.pathname === "/esc-sso/oauth2.0/authorize") {
      return new Response(null, { status: 302, headers: { Location: "/" } });
    }
    if (url.pathname === "/") {
      return new Response(null, { status: 302, headers: { Location: "/login/mfaLogin.html" } });
    }
    if (url.pathname === "/login/mfaLogin.html") {
      return new Response("<html>Secondary Authentication</html>");
    }
    if (url.pathname === "/esc-sso/api/v3/auth/queryAllValid") {
      return Response.json({
        code: "0",
        data: {
          config: {
            username: "student.name24",
            mobile: "138****8000",
            email: "s***@student.xjtlu.edu.cn",
            mfaAuth: {
              count: 1,
              currentStep: 1,
              auths: [
                { type: "webExtendEmailCodeAuth" },
                { type: "webOtpAuth" },
                { type: "webSmsAuth" },
              ],
            },
          },
          login: {
            webOtpAuth: { otpLength: 6, passwordType: "0" },
            webSmsAuth: { codeLength: 6, resend: 60, staticPassword: "0" },
          },
          loginExtends: {
            webExtendEmailCodeAuth: { codeLength: 6, timeout: 60, staticPassword: "0" },
          },
        },
      });
    }
    if (url.pathname === "/esc-sso/api/v3/email/send") {
      assert.equal(url.searchParams.get("username"), "student.name24");
      emailSends += 1;
      return Response.json({ code: "0" });
    }
    if (url.pathname === "/esc-sso/api/v3/sms/send") {
      assert.equal(url.searchParams.get("username"), "student.name24");
      smsSends += 1;
      return Response.json({ code: "0" });
    }
    throw new Error(`Unexpected URL: ${url.toString()}`);
  };

  const {
    beginXjtluLogin,
    sendXjtluMfaCode,
    submitXjtluLogin,
    submitXjtluMfa,
  } = await import("../src/services/xjtluSsoClient");

  const begin = await beginXjtluLogin();
  const primary = await submitXjtluLogin({
    pendingId: begin.pendingId,
    username: "student.name24",
    password: "local-test-password",
  });
  assert.equal(primary.ok, false);
  assert.equal(primary.needMfa, true);
  assert.deepEqual(primary.mfa?.methods.map((method) => method.type), ["email", "otp", "sms"]);
  assert.equal(emailSends, 0);
  assert.equal(smsSends, 0);

  const emailSent = await sendXjtluMfaCode({ pendingId: begin.pendingId, method: "email" });
  assert.equal(emailSent.ok, true);
  const smsSent = await sendXjtluMfaCode({ pendingId: begin.pendingId, method: "sms" });
  assert.equal(smsSent.ok, true);
  assert.equal(emailSends, 1);
  assert.equal(smsSends, 1);

  const badEmail = await submitXjtluMfa({
    pendingId: begin.pendingId,
    method: "email",
    code: "111111",
  });
  assert.equal(badEmail.ok, false);
  const badSms = await submitXjtluMfa({
    pendingId: begin.pendingId,
    method: "sms",
    code: "222222",
  });
  assert.equal(badSms.ok, false);
  const verified = await submitXjtluMfa({
    pendingId: begin.pendingId,
    method: "otp",
    code: "654321",
  });
  assert.deepEqual(verified, { ok: true, username: "student.name24" });
  assert.deepEqual(submittedMfaTypes, ["webExtendEmailCodeAuth", "webSmsAuth", "webOtpAuth"]);

  const replay = await submitXjtluMfa({
    pendingId: begin.pendingId,
    method: "otp",
    code: "654321",
  });
  assert.equal(replay.ok, false);
});
