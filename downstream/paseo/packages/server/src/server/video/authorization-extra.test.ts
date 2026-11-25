import { describe, expect, it } from "vitest";
import { editorPrincipalForCaller } from "./authorization.js";
import type { EditorPrincipal } from "#video-editor/contracts/v1";

// Complements authorization.test.ts: pins the privilege-escalation guards in
// editorPrincipalForCaller — the "owner" principal id alone (without the
// daemon.manage permission) grants nothing, and an explicit device credential
// takes precedence over an owner-looking session.

const viewer: EditorPrincipal = { principalId: "viewer-1", role: "viewer", projectIds: ["p1"] };

describe("editorPrincipalForCaller privilege guards", () => {
  it("does not grant owner from the principal id alone", () => {
    expect(() => editorPrincipalForCaller({ principalId: "owner", permissions: [] })).toThrow(
      "no video editor credential",
    );
  });

  it("requires daemon.manage specifically, not an unrelated permission", () => {
    expect(() =>
      editorPrincipalForCaller({ principalId: "owner", permissions: ["daemon.read"] }),
    ).toThrow("no video editor credential");
  });

  it("prefers an explicit device credential over an owner-looking session", () => {
    expect(
      editorPrincipalForCaller({
        principalId: "owner",
        permissions: ["daemon.manage"],
        editorPrincipal: viewer,
      }),
    ).toEqual(viewer);
  });
});