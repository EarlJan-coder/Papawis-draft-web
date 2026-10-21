import { describe, expect, it } from "vitest";
import { formToProfileInput } from "./form-input";

/**
 * FormData → validation-input normalization (the profile form posts raw
 * HTML form values). The break these catch: empty text inputs reaching the
 * schema as "" (a validation error) or positions arriving as a single
 * string instead of an array.
 */
describe("formToProfileInput", () => {
  it("collects positions from checkbox groups into an array", () => {
    const fd = new FormData();
    fd.append("displayName", "Marcus Rivera");
    fd.append("positions", "PG");
    fd.append("positions", "G");

    const input = formToProfileInput(fd) as { positions: string[] };
    expect(input.positions).toEqual(["PG", "G"]);
  });

  it("passes empty text inputs through as empty strings (schema treats as absent)", () => {
    const fd = new FormData();
    fd.append("displayName", "Marcus Rivera");
    fd.append("positions", "PG");
    fd.append("heightCm", "");
    fd.append("dateOfBirth", "");

    const input = formToProfileInput(fd) as Record<string, unknown>;
    expect(input.heightCm).toBe("");
    expect(input.dateOfBirth).toBe("");
  });

  it("includes whatever fields are present and nothing made up", () => {
    const fd = new FormData();
    fd.append("displayName", "Marcus Rivera");
    fd.append("positions", "PG");
    fd.append("skillLevel", "intermediate");

    const input = formToProfileInput(fd) as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual([
      "displayName",
      "positions",
      "skillLevel",
    ]);
  });
});
