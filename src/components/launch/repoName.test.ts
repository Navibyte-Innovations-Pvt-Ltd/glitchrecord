// Repo-name display tests — run: bun test repoName.test.ts
import { describe, expect, it } from "vitest";
import { bareName, orgName } from "./repoName";

describe("bareName", () => {
  it("returns just the repo for an org/repo fullName", () => {
    expect(bareName("Navibyte-Innovations-Pvt-Ltd/glitchrecord")).toBe("glitchrecord");
  });
  it("returns the whole string when there is no slash", () => {
    expect(bareName("glitchrecord")).toBe("glitchrecord");
  });
  it("handles null/undefined", () => {
    expect(bareName(null)).toBe("");
    expect(bareName(undefined)).toBe("");
  });
  it("keeps only the last segment for nested paths", () => {
    expect(bareName("org/group/repo")).toBe("repo");
  });
});

describe("orgName", () => {
  it("returns the org prefix for an org/repo fullName", () => {
    expect(orgName("Navibyte-Innovations-Pvt-Ltd/glitchrecord")).toBe("Navibyte-Innovations-Pvt-Ltd");
  });
  it("returns empty when there is no slash", () => {
    expect(orgName("glitchrecord")).toBe("");
  });
  it("handles null/undefined", () => {
    expect(orgName(null)).toBe("");
  });
  it("returns everything before the LAST slash for nested paths", () => {
    expect(orgName("org/group/repo")).toBe("org/group");
  });
});
