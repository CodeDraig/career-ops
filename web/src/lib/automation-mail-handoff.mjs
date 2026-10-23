/** Parse the one-use handoff from an automation review card into Mail. */
export function parseAutomationMailHandoff(value) {
  let seed;
  try { seed = typeof value === "string" ? JSON.parse(value) : value; }
  catch { throw new Error("The automation draft handoff is invalid."); }
  if (!seed || typeof seed !== "object" || Array.isArray(seed) || !seed.draft
      || typeof seed.automationDraftId !== "string"
      || !/^[a-f0-9]{64}$/.test(seed.automationContextDigest || "")
      || !["reply", "followup"].includes(seed.automationKind)
      || typeof seed.account !== "string") {
    throw new Error("The automation draft handoff is incomplete.");
  }
  return {
    account: seed.account,
    appNum: seed.appNum,
    messageId: seed.messageId || null,
    draft: seed.draft,
    automation: { id: seed.automationDraftId, contextDigest: seed.automationContextDigest, kind: seed.automationKind },
    logFollowup: !!seed.logFollowup,
  };
}

export function automationMailPrepareFields(context) {
  return context ? {
    automationDraftId: context.id,
    automationContextDigest: context.contextDigest,
    automationKind: context.kind,
  } : {};
}
