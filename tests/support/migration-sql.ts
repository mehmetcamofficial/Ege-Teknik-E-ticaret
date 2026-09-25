/** Returns every reason the SQL is not purely additive (shared by the migration tests). */
export function destructiveReasons(sql: string): string[] {
  const withoutFkActions = sql.replace(/ON DELETE no action ON UPDATE no action/g, "");
  const reasons: string[] = [];
  for (const keyword of ["DROP", "TRUNCATE", "DELETE", "UPDATE", "INSERT", "RENAME", "ALTER COLUMN"]) if (new RegExp(`\\b${keyword}\\b`, "i").test(withoutFkActions)) reasons.push(keyword);
  return reasons;
}
