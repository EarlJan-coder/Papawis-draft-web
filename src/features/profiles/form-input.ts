/**
 * Normalizes an HTML `FormData` submission into the object shape
 * `profileInputSchema` expects.
 *
 * - Checkbox groups arrive as repeated `positions` entries (present) or
 *   not at all; both become an array.
 * - Every other field is a raw string; the schema treats "" as "not
 *   provided", so values pass through untouched.
 */
export function formToProfileInput(formData: FormData): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (key === "positions") {
      const positions = (input.positions as string[] | undefined) ?? [];
      positions.push(value);
      input.positions = positions;
    } else {
      input[key] = value;
    }
  }
  if (!Array.isArray(input.positions)) {
    input.positions = [];
  }
  return input;
}
