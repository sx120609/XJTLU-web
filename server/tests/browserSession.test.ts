import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.JWT_SECRET = "xjtlu-browser-session-test-secret-32";

test("browser auth uses an opaque HttpOnly cookie and enforces CSRF", async () => {
  const {
    BROWSER_SESSION_COOKIE,
    CSRF_COOKIE,
    issueBrowserSession,
    loadBrowserSession,
  } = await import("../src/services/browserSession");
  const { requestOriginAndCsrfProtection } = await import("../src/middleware/browserSession");

  const cookies = new Map<string, { value: string; options: Record<string, unknown> }>();
  const response = {
    cookie(name: string, value: string, options: Record<string, unknown>) {
      cookies.set(name, { value, options });
      return this;
    },
    setHeader() { return this; },
  } as any;

  const siteToken = "site-token-that-must-never-be-written-to-the-browser-cookie";
  const issued = await issueBrowserSession(response, { siteToken, persistent: false });
  const sessionCookie = cookies.get(BROWSER_SESSION_COOKIE)!;
  const csrfCookie = cookies.get(CSRF_COOKIE)!;
  assert.equal(sessionCookie.options.httpOnly, true);
  assert.equal(sessionCookie.options.sameSite, "strict");
  assert.equal(Object.hasOwn(sessionCookie.options, "maxAge"), false);
  assert.notEqual(sessionCookie.value, siteToken);
  assert.equal(csrfCookie.options.httpOnly, false);

  const request = {
    method: "POST",
    protocol: "http",
    browserSession: issued,
    headers: {
      cookie: `${BROWSER_SESSION_COOKIE}=${sessionCookie.value}; ${CSRF_COOKIE}=${csrfCookie.value}`,
    },
    get(name: string) {
      const values: Record<string, string> = {
        host: "127.0.0.1:3011",
        origin: "http://127.0.0.1:3011",
        "x-xjtlu-auth-mode": "cookie",
        "x-csrf-token": csrfCookie.value,
      };
      return values[name.toLowerCase()] || "";
    },
  } as any;

  const loaded = await loadBrowserSession(request);
  assert.equal(loaded?.session.siteToken, siteToken);

  let nextError: unknown;
  requestOriginAndCsrfProtection(request, {} as any, (error?: unknown) => { nextError = error; });
  assert.equal(nextError, undefined);

  request.get = (name: string) => name.toLowerCase() === "host" ? "127.0.0.1:3011" : (
    name.toLowerCase() === "origin" ? "http://127.0.0.1:3011" : (
      name.toLowerCase() === "x-xjtlu-auth-mode" ? "cookie" : ""
    )
  );
  requestOriginAndCsrfProtection(request, {} as any, (error?: unknown) => { nextError = error; });
  assert.equal((nextError as { status?: number })?.status, 403);
});
