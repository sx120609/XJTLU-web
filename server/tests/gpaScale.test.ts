import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateWeightedFourPointGpa,
  convertToFourPointGrade,
  scoreToFourPointGpa,
  scoreToLetterGrade,
} from "../src/services/gpaScale";

test("4.0 GPA conversion follows every configured numeric boundary", () => {
  const cases: Array<[number, number, string]> = [
    [100, 4.0, "A"],
    [70, 4.0, "A"],
    [69.99, 3.7, "A−"],
    [65, 3.7, "A−"],
    [64.99, 3.3, "B+"],
    [60, 3.3, "B+"],
    [59.99, 3.0, "B"],
    [50, 3.0, "B"],
    [49.99, 2.3, "C+"],
    [45, 2.3, "C+"],
    [44.99, 2.0, "C"],
    [40, 2.0, "C"],
    [39.99, 0, "F"],
    [0, 0, "F"],
  ];
  for (const [score, gpa, letter] of cases) {
    assert.equal(scoreToFourPointGpa(score), gpa, `GPA at ${score}`);
    assert.equal(scoreToLetterGrade(score), letter, `letter at ${score}`);
  }
  assert.deepEqual(convertToFourPointGrade("94%"), { score: 94, gpa: 4, letter: "A" });
});

test("4.0 GPA conversion keeps qualitative grades deterministic", () => {
  assert.equal(scoreToFourPointGpa("优秀"), 4.0);
  assert.equal(scoreToFourPointGpa("良好"), 3.7);
  assert.equal(scoreToFourPointGpa("中等"), 3.0);
  assert.equal(scoreToFourPointGpa("及格"), 2.0);
  assert.equal(scoreToFourPointGpa("未通过"), 0);
  assert.equal(scoreToFourPointGpa("待发布"), undefined);
});

test("weighted GPA includes zero-point failures and ignores unpublished or zero-credit rows", () => {
  assert.deepEqual(calculateWeightedFourPointGpa([
    { score: 70, credits: 10 },
    { score: 65, credits: "5" },
    { score: 39, credits: 5 },
    { score: "", credits: 20 },
    { score: 90, credits: 0 },
  ]), {
    gpa: 2.93,
    credits: 20,
    courseCount: 3,
  });
  assert.deepEqual(calculateWeightedFourPointGpa([]), { gpa: null, credits: 0, courseCount: 0 });
});
