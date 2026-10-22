import { describe, expect, it } from "vitest";
import { positionCoverageWarnings, POSITION_LABELS } from "./coverage";

/**
 * Position-coverage advisories (Phase 6). Pure — the roster UI calls this
 * for warnings only; nothing is ever blocked on it.
 */

describe("position coverage", () => {
  it("warns about missing guard and missing center", () => {
    const warnings = positionCoverageWarnings([
      { positions: ["PF", "PF"] },
      { positions: ["SF"] },
    ]);
    expect(warnings).toContain("No point guard (PG) on the roster.");
    expect(warnings).toContain("No shooting guard (SG) on the roster.");
    expect(warnings).toContain("No center (C) on the roster.");
    expect(warnings.some((w) => w.includes("small forward"))).toBe(false);
  });

  it("warns when a single position dominates", () => {
    const warnings = positionCoverageWarnings([
      { positions: ["PG"] },
      { positions: ["PG"] },
      { positions: ["PG"] },
      { positions: ["C"] },
    ]);
    expect(warnings).toContain("Three or more players at point guard (PG).");
  });

  it("stays quiet for a full, balanced roster", () => {
    expect(positionCoverageWarnings([])).toEqual([]);
    const balanced = positionCoverageWarnings([
      { positions: ["PG"] },
      { positions: ["SG"] },
      { positions: ["SF"] },
      { positions: ["PF"] },
      { positions: ["C"] },
    ]);
    expect(balanced).toEqual([]);
  });

  it("ignores unknown position codes", () => {
    // XX contributes nothing; all five real positions are covered.
    const warnings = positionCoverageWarnings([
      { positions: ["XX", "PG"] },
      { positions: ["SG"] },
      { positions: ["SF"] },
      { positions: ["PF"] },
      { positions: ["C"] },
    ]);
    expect(warnings).toEqual([]);
  });

  it("labels every roster position", () => {
    expect(POSITION_LABELS.C).toBe("center (C)");
    expect(POSITION_LABELS.PG).toBe("point guard (PG)");
  });
});
