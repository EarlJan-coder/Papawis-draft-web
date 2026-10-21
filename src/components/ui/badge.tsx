import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

type Tone = "brand" | "success" | "warning" | "danger" | "neutral";

const toneClasses: Record<Tone, string> = {
  brand: "bg-brand-100 text-brand-800 border-brand-200",
  success: "bg-green-50 text-green-800 border-green-200",
  warning: "bg-amber-50 text-amber-800 border-amber-200",
  danger: "bg-red-50 text-red-800 border-red-200",
  neutral: "bg-muted text-muted-foreground border-border",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

/**
 * Status badge. Statuses always pair color with text (never color alone),
 * and include a dot glyph so meaning survives grayscale.
 */
export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
