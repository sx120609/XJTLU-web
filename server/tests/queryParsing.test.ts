import assert from "node:assert/strict";
import test from "node:test";
import { boundedQueryInteger, positiveRouteInteger, queryPage, querySize } from "../src/utils/query";

test("query integers fall back safely instead of passing invalid values to Prisma", () => {
  assert.equal(queryPage("abc"), 1);
  assert.equal(queryPage("Infinity"), 1);
  assert.equal(queryPage("2.9"), 2);
  assert.equal(queryPage("-5"), 1);
  assert.equal(queryPage("999999999"), 100_000);
  assert.equal(querySize("bad", 24, 8, 60), 24);
  assert.equal(querySize(["12", "30"], 24, 8, 60), 12);
  assert.equal(boundedQueryInteger({}, { fallback: 7, min: 1, max: 10 }), 7);
  assert.equal(positiveRouteInteger("42"), 42);
  assert.equal(positiveRouteInteger("not-a-number"), null);
  assert.equal(positiveRouteInteger("1.5"), null);
});
