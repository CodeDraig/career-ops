/** Canonical English tracker stages are case-insensitive. Unknown values stay visible. */
export function canonStatus(status) {
  return String(status ?? "").trim().toUpperCase();
}
