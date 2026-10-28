// @ts-expect-error Bun executes tests; web tsconfig intentionally loads only Vite globals.
import { expect, test } from "bun:test";
import { preferredMeDisplay } from "./meDisplay";

test("uses authoritative human nickname over differing SSO and handle fields", () => {
  expect(preferredMeDisplay({name:"oidc:subject",kind:"human",preferred_display:"chosen",display_name:"SSO Name",handle:"chosen"})).toBe("chosen");
});
test("honors server fallback for generated handles without guessing manual provenance", () => {
  expect(preferredMeDisplay({name:"oidc:subject",kind:"human",preferred_display:"SSO Name",display_name:"SSO Name",handle:"github-1234567890"})).toBe("SSO Name");
});
test("agent's resolved nickname is not replaced by owner metadata", () => {
  expect(preferredMeDisplay({name:"agent-identity",kind:"agent",preferred_display:"My helper",display_name:"Owner Name",handle:"owner-handle"})).toBe("My helper");
});
test("old server agent cannot be mislabeled with owner display or handle", () => {
  expect(preferredMeDisplay({name:"agent-identity",kind:"agent",display_name:"Owner Name",handle:"owner-handle"})).toBe("agent-identity");
});
test("empty preferred labels retain nonempty legacy human fallbacks", () => {
  expect(preferredMeDisplay({name:"human-id",kind:"human",preferred_display:"  ",display_name:" SSO Name ",handle:"handle"})).toBe("SSO Name");
  expect(preferredMeDisplay({name:"human-id",kind:"human",display_name:" ",handle:" handle "})).toBe("handle");
  expect(preferredMeDisplay({name:"human-id",kind:"human",handle:" "})).toBe("human-id");
});
