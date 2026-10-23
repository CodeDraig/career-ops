import test from "node:test";
import assert from "node:assert/strict";
import { automationMailPrepareFields, parseAutomationMailHandoff } from "../../src/lib/automation-mail-handoff.mjs";

const digest = "a".repeat(64);

test("automation mail handoff maps a reviewed seed into the existing composer fields", () => {
  const handoff = parseAutomationMailHandoff({
    account: "work", appNum: 8, messageId: "imap-hash", draft: { to: ["recruiter@example.test"], subject: "Re: role", body: "Thanks" },
    automationDraftId: "task_8", automationContextDigest: digest, automationKind: "reply", logFollowup: true,
  });
  assert.equal(handoff.account, "work");
  assert.equal(handoff.appNum, 8);
  assert.deepEqual(handoff.automation, { id: "task_8", contextDigest: digest, kind: "reply" });
  assert.deepEqual(automationMailPrepareFields(handoff.automation), {
    automationDraftId: "task_8", automationContextDigest: digest, automationKind: "reply",
  });
  assert.deepEqual(automationMailPrepareFields(null), {});
});

test("automation mail handoff rejects missing or malformed source freshness data", () => {
  assert.throws(() => parseAutomationMailHandoff("{"), /handoff is invalid/);
  assert.throws(() => parseAutomationMailHandoff({ account: "work", draft: {}, automationDraftId: "x", automationContextDigest: "bad", automationKind: "reply" }), /handoff is incomplete/);
});
