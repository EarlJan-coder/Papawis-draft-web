/**
 * Centralized, configurable league branding.
 * Never hardcode league names in components — read them from here.
 */
export function getLeagueName(): string {
  return process.env.LEAGUE_NAME?.trim() || "Papawis League";
}
