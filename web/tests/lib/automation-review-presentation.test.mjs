import test from "node:test";
import assert from "node:assert/strict";
import { canConfirmApplicationMatch, canRetryTask, sourceReviewDetails } from "../../src/lib/automation-review-presentation.mjs";

test("retry is available only when the task is in a retryable state", () => {
  for (const state of ["blocked", "failed", "retry_waiting", "cancelled"]) assert.equal(canRetryTask({ state }), true);
  for (const state of ["review_ready", "queued", "running", "completed", undefined]) assert.equal(canRetryTask({ state }), false);
});

test("application match accepts a positive safe integer and rejects invalid input", () => {
  for (const value of ["1", "42"]) assert.equal(canConfirmApplicationMatch(value), true);
  for (const value of ["", "0", "-1", "1.5", "not a number", "9007199254740992"]) assert.equal(canConfirmApplicationMatch(value), false);
});

test("source repair details expose bounded source and attempt metadata without message content", () => {
  const details = sourceReviewDetails({
    source: { sourceId: "employer-board", provider: "workday", error: "HTTP 503", warnings: ["slow response"] },
    attemptResults: [{ status: "error", statusCode: 503, error: "temporary" }],
    body: "private mail body", receiptPath: "/tmp/run.json",
  });
  assert.deepEqual(details, [
    ["sourceId", "employer-board"], ["provider", "workday"], ["error", "HTTP 503"], ["warnings", "slow response"],
    ["Attempt 1 status", "error"], ["Attempt 1 statusCode", "503"], ["Attempt 1 error", "temporary"], ["receiptPath", "/tmp/run.json"],
  ]);
  assert.equal(details.some(([, value]) => value.includes("private mail body")), false);
});
