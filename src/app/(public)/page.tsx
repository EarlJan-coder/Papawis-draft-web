import Link from "next/link";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getLeagueName } from "@/lib/config";

/**
 * Public landing page. Shows only public league information — no private
 * player data, no live draft state.
 */
export default function HomePage() {
  const leagueName = getLeagueName();

  const steps = [
    {
      title: "1. Register & build your profile",
      body: "Create an account and tell us your positions, height, and experience.",
    },
    {
      title: "2. Organizer approval",
      body: "The organizer reviews your profile and marks you eligible for the draft.",
    },
    {
      title: "3. Captain draft",
      body: "Four captains take turns selecting players in a snake draft order.",
    },
    {
      title: "4. Published rosters",
      body: "Final team rosters are published for everyone in the league to see.",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 px-6 py-14 text-center text-white sm:px-12">
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
          {leagueName}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-brand-100 sm:text-lg">
          Register, get approved, and get drafted. A fair, transparent snake
          draft for a four-team basketball league.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 transition-colors"
          >
            Register as a player
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-white/60 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
          >
            Log in
          </Link>
        </div>
      </section>

      <section className="mt-12" aria-labelledby="how-it-works">
        <h2 id="how-it-works" className="text-2xl font-semibold">
          How the draft works
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <Card key={step.title}>
              <CardTitle className="text-base text-brand-700">
                {step.title}
              </CardTitle>
              <CardDescription className="mt-2 leading-relaxed">
                {step.body}
              </CardDescription>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-12 rounded-lg border border-border bg-white p-6">
        <h2 className="text-lg font-semibold">Registration status</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Registration is open. Sign up to create your player profile — the
          organizer will review it before draft day.
        </p>
      </section>
    </div>
  );
}
