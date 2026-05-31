// Split a GitHub "owner/repo" fullName for display — show the repo name
// prominently, the org as a subtitle. Pure + unit-testable.
export function bareName(full?: string | null): string {
  return full && full.includes("/") ? full.split("/").pop()! : (full ?? "");
}

export function orgName(full?: string | null): string {
  return full && full.includes("/") ? full.slice(0, full.lastIndexOf("/")) : "";
}
