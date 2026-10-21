import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-12 text-center">
      <span aria-hidden="true" className="text-5xl">🚫</span>
      <h1 className="mt-4 text-2xl font-semibold">Access denied</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Your account does not have permission to view this page. If you believe
        this is a mistake, contact the league organizer.
      </p>
      <div className="mt-6">
        <Link href="/dashboard">
          <Button variant="outline">Back to dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
