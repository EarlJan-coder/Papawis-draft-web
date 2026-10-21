/**
 * Minimal class-name joiner (no external dependency).
 * Filters falsy values so conditional Tailwind classes read naturally.
 */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Masks an email address for display to users who do not own it:
 * "john.doe@example.com" → "j***@example.com". Malformed input is fully
 * masked rather than echoed back.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dots = local.length >= 3 ? "***" : "*";
  return `${local[0]}${dots}@${domain}`;
}
