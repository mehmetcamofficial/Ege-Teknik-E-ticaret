/**
 * The only thing from a database error that may reach a log: a 5-character SQLSTATE. drizzle wraps the driver error in a
 * DrizzleQueryError whose `cause` carries the real code, so look through a few levels. Messages, hosts, roles and SQL are never returned.
 */
export function sqlStateOf(error: unknown): string {
  for (let depth = 0, cursor: unknown = error; depth < 3 && cursor && typeof cursor === "object"; depth++, cursor = (cursor as { cause?: unknown }).cause) {
    const candidate = (cursor as { code?: unknown }).code;
    if (typeof candidate === "string" && /^[0-9A-Z]{5}$/.test(candidate)) return candidate;
  }
  return "unknown";
}
