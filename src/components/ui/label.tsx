import { cn } from "@/lib/utils";
import type { HTMLAttributes, LabelHTMLAttributes } from "react";

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "mb-1.5 block text-sm font-medium text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Accessible inline error message. Not color-only: includes an icon glyph
 * and is announced via role="alert".
 */
export function FieldError({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      role="alert"
      className={cn("mt-1.5 text-sm font-medium text-destructive", className)}
      {...props}
    />
  );
}
