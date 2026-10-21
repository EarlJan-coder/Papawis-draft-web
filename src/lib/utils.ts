/**
 * Minimal class-name joiner (no external dependency).
 * Filters falsy values so conditional Tailwind classes read naturally.
 */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}
