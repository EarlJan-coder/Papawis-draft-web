import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

/**
 * Better Auth catch-all handler: /api/auth/*
 * Registration, sign-in, sign-out, session, etc.
 */
export const { POST, GET } = toNextJsHandler(auth);
