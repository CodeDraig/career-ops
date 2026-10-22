/** Mail fields shared by the inbox and compose view, kept plain for node tests. */
export function classificationLabel(classification) {
  if (classification && typeof classification === "object" && typeof classification.type === "string") return classification.type;
  return typeof classification === "string" && classification ? classification : "Unclassified";
}

/** Core matcher confidence is a named band, not a numeric probability. */
export function confidenceLabel(confidence) {
  return ["high", "medium", "low"].includes(String(confidence).toLowerCase())
    ? `${String(confidence)[0].toUpperCase()}${String(confidence).slice(1).toLowerCase()} confidence`
    : "Confidence unavailable";
}

/** An unmatched reply always begins unassociated, regardless of inbox filter. */
export function replyApplication(application) {
  return application && Number.isInteger(application.num) ? String(application.num) : "";
}

/** The view filter is separate from a draft's explicit application binding. */
export function syncAppFilter(viewApp) {
  return viewApp ? Number(viewApp) : undefined;
}
