const retryableTaskStates = new Set(["blocked", "failed", "retry_waiting", "cancelled"]);

export function canRetryTask(payload) {
  return Boolean(payload?.state && retryableTaskStates.has(String(payload.state)));
}

export function canConfirmApplicationMatch(value) {
  const appNum = Number(value);
  return Number.isSafeInteger(appNum) && appNum > 0;
}

function sourceDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value;
  const fields = ["sourceId", "name", "provider", "status", "kind", "statusCode", "error", "retryAfter", "complete", "jobs", "attempts", "warnings"];
  return fields.flatMap(key => {
    const field = record[key];
    if (field == null || typeof field === "object" && !Array.isArray(field)) return [];
    const text = Array.isArray(field) ? field.map(String).join("; ") : String(field);
    return text ? [[key, text]] : [];
  });
}

function sourceAttemptDetails(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((attempt, index) => sourceDetails(attempt).map(([key, text]) => [`Attempt ${index + 1} ${key}`, text]));
}

export function sourceReviewDetails(payload = {}) {
  const rows = [...sourceDetails(payload), ...sourceDetails(payload.source), ...sourceDetails(payload.attemptResult), ...sourceDetails(payload.attempts), ...sourceAttemptDetails(payload.attemptResults)];
  for (const key of ["receiptStartedAt", "receiptPath", "reason"]) {
    if (typeof payload[key] === "string") rows.push([key, payload[key]]);
  }
  return rows;
}
