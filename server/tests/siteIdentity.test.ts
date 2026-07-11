import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSiteLogoUrl, normalizeSiteName, normalizeSiteSubtitle } from "../src/services/siteSettings";

test("site identity normalizes configurable name and logo", () => {
  assert.equal(normalizeSiteName("  XJTLU\nCampus   Hub  "), "XJTLU Campus Hub");
  assert.equal(normalizeSiteName(""), "XJTLU 校园服务");
  assert.equal(normalizeSiteSubtitle("  学生\n服务   中心 "), "学生 服务 中心");
  assert.equal(normalizeSiteSubtitle(""), "西交利物浦校园互助服务");
  assert.equal(normalizeSiteLogoUrl("/uploads/site/logo.png"), "/uploads/site/logo.png");
  assert.equal(normalizeSiteLogoUrl("https://cdn.example.com/logo.png"), "https://cdn.example.com/logo.png");
  assert.equal(normalizeSiteLogoUrl(""), "");
  assert.throws(() => normalizeSiteLogoUrl("javascript:alert(1)"), /Logo 地址格式不正确/);
  assert.throws(() => normalizeSiteLogoUrl("//attacker.example/logo.png"), /Logo 地址格式不正确/);
});
