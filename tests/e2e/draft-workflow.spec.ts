import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { provisionOrganizer } from "@/features/admin/provision-organizer";
import { maskEmail } from "@/lib/utils";

/**
 * Phase 8 E2E: the full 12-step league workflow in one serial browser
 * journey, entirely through the real UI against the disposable
 * `papawis_e2e` database:
 *
 *   1.  Register all league members (organizer candidate, 4 captains, 4 players)
 *   2.  Provision the organizer (controlled script path — the only way roles change)
 *   3.  Players submit their profiles from the dashboard
 *   4.  Organizer approves every profile in the review queue
 *   5.  Organizer marks every profile draft-eligible
 *   6.  Organizer creates the four league teams
 *   7.  Organizer creates the draft (1 round = 4 picks)
 *   8.  Organizer assigns four captains with draft order 1–4
 *   9.  Organizer starts the draft (readiness checklist)
 *   10. The on-turn captain drafts a player from the board
 *   11. Organizer pauses, resumes, and undoes the pick; captain re-picks
 *   12. Remaining captains pick, the draft completes, rosters are published,
 *       and the public homepage shows them (audit trail records it all)
 */

const ORG = "Olive Organizer";
const CAPTAINS = ["Cap One", "Cap Two", "Cap Three", "Cap Four"];
const POOL = ["Pool One", "Pool Two", "Pool Three", "Pool Four"];
const TEAMS = ["Alpha", "Beta", "Gamma", "Delta"];

// Unique per run so repeated E2E runs never collide (DB is wiped, but the
// sign-up rate-limit window is per-minute and shared).
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 10000)}`;

const emailFor = (tag: string) => `e2e-${RUN}-${tag}@example.com`;
const teamName = (team: string) => `${team} ${RUN}`;

test.describe("full league draft workflow", () => {
  let orgContext: BrowserContext;
  let orgPage: Page;
  let memberContexts: Array<{
    name: string;
    context: BrowserContext;
    page: Page;
  }>;

  test.afterAll(async () => {
    // Close browser contexts, then release the spec's own DB pool so the
    // worker can exit.
    await orgContext?.close();
    for (const member of memberContexts ?? []) await member.context.close();
    const pool = (
      globalThis as { __papawisPool?: { end: () => Promise<void> } }
    ).__papawisPool;
    await pool?.end();
  });

  async function register(page: Page, name: string, email: string) {
    await page.goto("/register");
    await page.locator("#name").fill(name);
    await page.locator("#email").fill(email);
    await page.locator("#password").fill("Sup3rSecret!pw");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/dashboard");
    await expect(page.getByRole("heading", { name: `Welcome, ${name}` })).toBeVisible();
  }

  async function submitProfile(page: Page, displayName: string) {
    await page.goto("/dashboard");
    await page.locator("#displayName").fill(displayName);
    await page.getByRole("checkbox", { name: "PG" }).check();
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Profile submitted for organizer approval.",
    );
  }

  test("12 steps: register → approve → teams → draft → pause/undo → publish", async ({
    browser,
  }) => {
    // ---------------------------------------------------------------- steps 1–2
    await test.step("1. register all league members", async () => {
      orgContext = await browser.newContext();
      orgPage = await orgContext.newPage();
      // Publish uses window.confirm; accept every dialog on this page.
      orgPage.on("dialog", (dialog) => void dialog.accept());

      await register(orgPage, ORG, emailFor("org"));

      // Captains + pool players register (and land on their dashboard).
      memberContexts = [];
      for (const name of [...CAPTAINS, ...POOL]) {
        const tag = name.toLowerCase().replace(/\s+/g, "-");
        const context = await browser.newContext();
        const page = await context.newPage();
        await register(page, name, emailFor(tag));
        memberContexts.push({ name, context, page });
      }
    });

    await test.step("2. provision the organizer", async () => {
      const result = await provisionOrganizer(emailFor("org"));
      expect(result).toMatchObject({ ok: true });
    });

    // ------------------------------------------------------------------- steps 3–5
    await test.step("3. players submit profiles", async () => {
      for (const member of memberContexts) {
        await submitProfile(member.page, member.name);
      }
    });

    await test.step("4. organizer approves every profile", async () => {
      await orgPage.goto("/organizer");
      const approveButtons = orgPage.getByRole("button", { name: "Approve", exact: true });
      await expect(approveButtons).toHaveCount(memberContexts.length);
      let count = memberContexts.length;
      while (count > 0) {
        await approveButtons.first().click();
        await expect(approveButtons).toHaveCount(count - 1);
        count -= 1;
      }
      await expect(orgPage.getByText("No profiles waiting for review.")).toBeVisible();
    });

    await test.step("5. organizer marks everyone draft-eligible", async () => {
      await orgPage.goto("/organizer");
      const eligibleButtons = orgPage.getByRole("button", {
        name: "Make eligible",
        exact: true,
      });
      await expect(eligibleButtons).toHaveCount(memberContexts.length);
      let count = memberContexts.length;
      while (count > 0) {
        await eligibleButtons.first().click();
        await expect(eligibleButtons).toHaveCount(count - 1);
        count -= 1;
      }
      await expect(
        orgPage.getByRole("button", { name: "Remove eligibility", exact: true }),
      ).toHaveCount(memberContexts.length);
    });

    // ------------------------------------------------------------------- steps 6–9
    await test.step("6. create the four league teams", async () => {
      await orgPage.goto("/organizer");
      for (const team of TEAMS) {
        await orgPage.getByLabel("New team name").fill(teamName(team));
        await orgPage.getByRole("button", { name: "Add team", exact: true }).click();
        await expect(
          orgPage.getByText(teamName(team), { exact: true }),
        ).toBeVisible();
      }
      await expect(orgPage.getByText("The league is capped at four teams.")).toBeVisible();
    });

    await test.step("7. create the draft with 1 round", async () => {
      await orgPage.getByLabel("Number of rounds").fill("1");
      await orgPage.getByRole("button", { name: "Create draft", exact: true }).click();
      await expect(orgPage.getByText("Start checklist")).toBeVisible();
    });

    await test.step("8. assign four captains with draft order 1–4", async () => {
      for (let i = 0; i < TEAMS.length; i++) {
        const team = teamName(TEAMS[i]!);
        const email = emailFor(CAPTAINS[i]!.toLowerCase().replace(/\s+/g, "-"));
        await orgPage
          .getByLabel(`Captain for ${team}`)
          .selectOption({ label: `${CAPTAINS[i]} (${maskEmail(email)})` });
        await orgPage
          .getByLabel(`Draft order for ${team}`)
          .selectOption(String(i + 1));
        await orgPage
          .locator("form")
          .filter({ has: orgPage.getByLabel(`Captain for ${team}`) })
          .getByRole("button", { name: "Assign", exact: true })
          .click();
        await expect(
          orgPage.getByText(`Captain: ${CAPTAINS[i]} · Pick #${i + 1}`),
        ).toBeVisible();
      }
    });

    await test.step("9. start the draft", async () => {
      const startButton = orgPage.getByRole("button", {
        name: "Start draft",
        exact: true,
      });
      await expect(startButton).toBeEnabled();
      await startButton.click();
      await expect(
        orgPage.getByRole("button", { name: "Pause", exact: true }),
      ).toBeVisible();
    });

    // ------------------------------------------------------------------- steps 10–11
    const captainPage = (name: string) =>
      memberContexts.find((m) => m.name === name)!.page;

    async function pickAs(page: Page, playerName: string) {
      await page.goto("/draft");
      await expect(page.getByTestId("turn-banner")).toBeVisible();
      await expect(page.getByText(/It's your turn/)).toBeVisible();
      await page.getByLabel("Search players").fill(playerName);
      await page
        .locator("li")
        .filter({ has: page.getByRole("button", { name: "Draft", exact: true }) })
        .filter({ hasText: playerName })
        .getByRole("button", { name: "Draft", exact: true })
        .click();
      await expect(page.getByTestId("confirm-pick-dialog")).toBeVisible();
      await expect(page.getByTestId("confirm-pick-dialog")).toContainText(playerName);
      await page.getByRole("button", { name: "Confirm pick", exact: true }).click();
      await expect(page.getByTestId("confirm-pick-dialog")).toBeHidden();
    }

    await test.step("10. on-turn captain drafts a player", async () => {
      await pickAs(captainPage(CAPTAINS[0]!), POOL[0]!);
      const history = captainPage(CAPTAINS[0]!).getByTestId("pick-history");
      await expect(history.locator("li")).toHaveCount(1);
      await expect(history).toContainText(POOL[0]!);
    });

    await test.step("11. pause → resume → undo → re-pick", async () => {
      await orgPage.goto("/draft");

      // Pause with a reason, then resume.
      await orgPage.getByLabel("Pause reason").fill("E2E pause");
      await orgPage.getByRole("button", { name: "Pause draft", exact: true }).click();
      await expect(orgPage.getByText("Draft paused")).toBeVisible();

      await orgPage.getByRole("button", { name: "Resume draft", exact: true }).click();
      await expect(orgPage.getByText(/On the clock/)).toBeVisible();

      // Undo the first pick with a reason — the pick is soft-reversed.
      await orgPage.getByLabel("Undo reason").fill("Wrong player");
      await orgPage.getByRole("button", { name: "Undo last pick", exact: true }).click();
      await expect(orgPage.getByTestId("pick-history")).toContainText(
        "(undone: Wrong player)",
      );

      // The same captain is back on the clock and re-picks the freed player.
      await pickAs(captainPage(CAPTAINS[0]!), POOL[0]!);
      const history = captainPage(CAPTAINS[0]!).getByTestId("pick-history");
      await expect(history.locator("li")).toHaveCount(2);
      await expect(history).toContainText("(undone: Wrong player)");
    });

    // ------------------------------------------------------------------- step 12
    await test.step("12. remaining picks, completion, publish, public rosters", async () => {
      // Captains 2–4 finish the single round.
      await pickAs(captainPage(CAPTAINS[1]!), POOL[1]!);
      await pickAs(captainPage(CAPTAINS[2]!), POOL[2]!);
      await pickAs(captainPage(CAPTAINS[3]!), POOL[3]!);
      // The final pick auto-completes the draft.
      await expect(
        captainPage(CAPTAINS[3]!).getByText("Draft completed"),
      ).toBeVisible();

      // Organizer publishes the rosters from the draft room.
      await orgPage.goto("/draft");
      await expect(
        orgPage.getByRole("button", { name: "Publish rosters", exact: true }),
      ).toBeVisible();
      await orgPage
        .getByRole("button", { name: "Publish rosters", exact: true })
        .click();
      await expect(orgPage.getByTestId("publish-message")).toHaveText(
        "Rosters published.",
      );
      await expect(orgPage.getByTestId("published-indicator")).toBeVisible();

      // The audit trail records publication.
      await orgPage.goto("/organizer");
      await expect(orgPage.getByTestId("audit-panel")).toContainText(
        "draft.published",
      );

      // Anonymous visitors now see the published rosters — and nothing private.
      const anonContext = await browser.newContext();
      const home = await anonContext.newPage();
      await home.goto("/");
      await expect(home.getByTestId("published-rosters")).toBeVisible();
      await expect(home.getByText(teamName("Alpha"))).toBeVisible();
      for (const player of POOL) {
        await expect(home.getByText(player)).toBeVisible();
      }
      await expect(home.locator("body")).not.toContainText("@example.com");
      await anonContext.close();
    });
  });
});
