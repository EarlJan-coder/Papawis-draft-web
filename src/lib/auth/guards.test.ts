import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth";

/**
 * Unit tests for the centralized session/role guards.
 * next/headers, next/navigation, and the auth instance are mocked so these
 * run without a database; real end-to-end verification lives in
 * tests/integration/.
 */

const mocks = vi.hoisted(() => {
  class RedirectError extends Error {
    readonly url: string;
    constructor(url: string) {
      super(`NEXT_REDIRECT:${url}`);
      this.url = url;
    }
  }
  return {
    RedirectError,
    session: null as unknown,
    requestHeaders: new Headers(),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => mocks.session),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => mocks.requestHeaders),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new mocks.RedirectError(url);
  }),
}));

import {
  getSessionUser,
  requireApiUser,
  requireRole,
  requireUser,
} from "@/lib/auth/guards";

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Test Player",
    email: "player@example.com",
    emailVerified: false,
    image: null,
    role: "player",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SessionUser;
}

async function captureRedirect(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof mocks.RedirectError) return err.url;
    throw err;
  }
  throw new Error("Expected a redirect, but the call resolved.");
}

beforeEach(() => {
  mocks.session = null;
  mocks.requestHeaders = new Headers();
  vi.clearAllMocks();
});

describe("getSessionUser", () => {
  it("returns null when there is no session", async () => {
    expect(await getSessionUser()).toBeNull();
  });

  it("returns null for suspended accounts even with a valid session", async () => {
    mocks.session = { user: makeUser({ status: "suspended" }) };
    expect(await getSessionUser()).toBeNull();
  });

  it("returns the user for an active session", async () => {
    const user = makeUser();
    mocks.session = { user };
    expect(await getSessionUser()).toBe(user);
  });
});

describe("requireUser", () => {
  it("redirects anonymous visitors to /login", async () => {
    expect(await captureRedirect(requireUser())).toBe("/login");
  });

  it("treats suspended users as unauthenticated", async () => {
    mocks.session = { user: makeUser({ status: "suspended" }) };
    expect(await captureRedirect(requireUser())).toBe("/login");
  });

  it("returns the active user", async () => {
    const user = makeUser();
    mocks.session = { user };
    expect(await requireUser()).toBe(user);
  });
});

describe("requireRole", () => {
  it("redirects anonymous visitors to /login", async () => {
    expect(await captureRedirect(requireRole(["organizer"]))).toBe("/login");
  });

  it("redirects authenticated users without the required role to /forbidden", async () => {
    mocks.session = { user: makeUser({ role: "player" }) };
    expect(await captureRedirect(requireRole(["organizer"]))).toBe("/forbidden");
  });

  it("returns the user when the role matches", async () => {
    const user = makeUser({ role: "organizer" });
    mocks.session = { user };
    expect(await requireRole(["organizer"])).toBe(user);
  });
});

describe("requireApiUser", () => {
  it("returns 401 when there is no session", async () => {
    const result = await requireApiUser(new Headers());
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("returns 403 for suspended accounts", async () => {
    mocks.session = { user: makeUser({ status: "suspended" }) };
    const result = await requireApiUser(new Headers());
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("returns 403 when a role is required but not held", async () => {
    mocks.session = { user: makeUser({ role: "player" }) };
    const result = await requireApiUser(new Headers(), ["organizer"]);
    expect(result).toMatchObject({ ok: false, status: 403 });
    if (!result.ok) {
      expect(result.message).toBe(
        "You do not have permission to perform this action.",
      );
    }
  });

  it("returns the user when no roles are required", async () => {
    const user = makeUser({ role: "player" });
    mocks.session = { user };
    const result = await requireApiUser(new Headers());
    expect(result).toEqual({ ok: true, user });
  });

  it("accepts a user holding one of the required roles", async () => {
    const user = makeUser({ role: "organizer" });
    mocks.session = { user };
    const result = await requireApiUser(
      mocks.requestHeaders,
      ["organizer", "captain"],
    );
    expect(result).toEqual({ ok: true, user });
  });
});
