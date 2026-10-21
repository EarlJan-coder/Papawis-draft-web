"use client";

import { authClient } from "@/lib/auth/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await authClient.signOut();
          router.push("/");
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
