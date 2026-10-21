"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BASKETBALL_POSITIONS,
  SKILL_LEVELS,
} from "@/features/profiles/constants";
import {
  saveProfileAction,
  type ProfileFormState,
} from "@/features/profiles/actions";

/**
 * Player profile form (create + edit in one). Posts to the server action,
 * which validates and authorizes; the schema is the source of truth — this
 * markup only guides input.
 */

export type ProfileFormValues = {
  displayName: string;
  dateOfBirth: string | null;
  heightCm: number | null;
  positions: string[];
  skillLevel: string | null;
  experience: string | null;
  bio: string | null;
};

const initialState: ProfileFormState = { status: "idle" };

export function ProfileForm({ initial }: { initial: ProfileFormValues | null }) {
  const [state, formAction, pending] = useActionState(
    saveProfileAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.status !== "idle" && (
        <p
          role="status"
          className={
            state.status === "error"
              ? "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              : "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
          }
        >
          {state.message}
        </p>
      )}
      {state.issues && state.issues.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
          {state.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="displayName">Display name *</Label>
          <Input
            id="displayName"
            name="displayName"
            required
            maxLength={60}
            defaultValue={initial?.displayName ?? ""}
            placeholder="How you appear in the league"
          />
        </div>
        <div>
          <Label htmlFor="dateOfBirth">Date of birth</Label>
          <Input
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            defaultValue={initial?.dateOfBirth ?? ""}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Only your age is ever shown to others.
          </p>
        </div>
        <div>
          <Label htmlFor="heightCm">Height (cm)</Label>
          <Input
            id="heightCm"
            name="heightCm"
            type="number"
            min={100}
            max={260}
            defaultValue={initial?.heightCm ?? ""}
            placeholder="e.g. 183"
          />
        </div>
        <div>
          <Label htmlFor="skillLevel">Skill level</Label>
          <select
            id="skillLevel"
            name="skillLevel"
            defaultValue={initial?.skillLevel ?? ""}
            className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            <option value="">Not set</option>
            {SKILL_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-foreground">
          Positions * (at least one)
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {BASKETBALL_POSITIONS.map((position) => (
            <label
              key={position}
              className="flex items-center gap-2 text-sm text-foreground"
            >
              <input
                type="checkbox"
                name="positions"
                value={position}
                defaultChecked={initial?.positions.includes(position) ?? false}
                className="h-4 w-4 rounded border-input accent-[#7749b6]"
              />
              {position}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <Label htmlFor="experience">Experience</Label>
        <Input
          id="experience"
          name="experience"
          maxLength={300}
          defaultValue={initial?.experience ?? ""}
          placeholder="e.g. 3 seasons of intramural ball"
        />
      </div>

      <div>
        <Label htmlFor="bio">Bio</Label>
        <Textarea
          id="bio"
          name="bio"
          rows={3}
          maxLength={500}
          defaultValue={initial?.bio ?? ""}
          placeholder="Playing style, strengths, anything the organizers should know"
        />
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {pending
            ? "Saving…"
            : initial
              ? "Save profile"
              : "Submit for approval"}
        </Button>
      </div>
    </form>
  );
}
