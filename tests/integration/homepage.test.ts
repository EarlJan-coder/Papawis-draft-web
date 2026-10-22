import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HomePage from "@/app/(public)/page";
import { getLeagueName } from "@/lib/config";
import { publishDraft } from "@/features/publications/publication-service";
import { resetDatabase } from "../setup/db";
import { fillAllPicks, makeStartedDraft } from "../setup/draft-fixtures";

/**
 * Public homepage publication surface (Phase 7). The break these catch:
 * rosters (or any private data — names, emails, ids) rendering for
 * anonymous visitors before the organizer publishes, or leaking ids and
 * contact details after publication.
 */

async function renderHome(): Promise<string> {
  return renderToStaticMarkup(await HomePage());
}

describe("public homepage", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("shows only the pending state when nothing has been drafted", async () => {
    const html = await renderHome();
    expect(html).toContain('data-testid="rosters-pending"');
    expect(html).not.toContain('data-testid="published-rosters"');
    expect(html).toContain(getLeagueName());
    expect(html).not.toContain("@example.com");
  });

  it("keeps drafted rosters off the page until publication", async () => {
    const { draftId, captains } = await makeStartedDraft("home-priv", 1);
    // The draft even auto-completed — but nobody published it.
    await fillAllPicks("home-priv", draftId, captains, 1);

    const html = await renderHome();
    expect(html).toContain('data-testid="rosters-pending"');
    expect(html).not.toContain('data-testid="published-rosters"');

    // No player, captain, or team name from the unpublished draft.
    expect(html).not.toContain("home-priv");
    // No contact details or internal ids anywhere.
    expect(html).not.toContain("@example.com");
    expect(html).not.toContain(draftId);
  });

  it("renders published rosters without leaking ids or emails", async () => {
    const { organizer, draftId, captains, teamIds } = await makeStartedDraft(
      "home-pub",
      2,
    );
    await fillAllPicks("home-pub", draftId, captains, 2);
    expect((await publishDraft(organizer, draftId)).ok).toBe(true);

    const html = await renderHome();
    expect(html).toContain('data-testid="published-rosters"');
    expect(html).toContain(getLeagueName());

    // Team names and drafted players are visible…
    expect(html).toContain("home-pub-Alpha");
    expect(html).toContain("Player home-pub-p1");

    // …but nothing internal: no emails, no uuids (draft/team/profile ids).
    expect(html).toContain("Captain: Test User");
    expect(html).not.toContain("@example.com");
    expect(html).not.toContain(draftId);
    for (const teamId of teamIds) expect(html).not.toContain(teamId);
    expect(html).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });
});
