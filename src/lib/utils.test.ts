import { describe, expect, it } from "vitest";
import { maskEmail } from "./utils";

/**
 * Email masking contract: surfaces the user does not own (organizer queue,
 * future captain draft views) must never display a full email address.
 * The break these catch: any un-masked email rendered to another user.
 */
describe("maskEmail", () => {
  it("keeps the first character and masks the rest of the local part", () => {
    expect(maskEmail("john.doe@example.com")).toBe("j***@example.com");
  });

  it("masks minimally when the local part is two characters", () => {
    expect(maskEmail("jo@example.com")).toBe("j*@example.com");
  });

  it("handles a single-character local part", () => {
    expect(maskEmail("a@x.co")).toBe("a*@x.co");
  });

  it("returns a placeholder for malformed input", () => {
    expect(maskEmail("not-an-email")).toBe("***");
  });
});
