import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import type { auth } from "./index";

/**
 * Browser-side auth client. Talks to /api/auth/* on the same origin.
 * `inferAdditionalFields` surfaces the `role` / `status` types client-side;
 * the server still owns those fields (input: false on the server config).
 */
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>()],
});
