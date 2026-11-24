import type { FieldDef, Policy, PolicyOption } from "@/server/policy/schema";

/** Pure helpers for reading the policy config — safe to use in client components. */

export type ResolvedOption = PolicyOption & { coAuthors?: string[] };

export function resolveOptions(policy: Policy, field: FieldDef): ResolvedOption[] {
  if (field.options) return field.options;
  if (!field.optionsFrom) return [];
  const [group, list] = field.optionsFrom.split(".");
  if (group === "publication" && list) {
    const src = (policy.publication as Record<string, unknown>)[list];
    if (Array.isArray(src)) return src as ResolvedOption[];
  }
  return [];
}

export function visibleOptions(policy: Policy, field: FieldDef, values: Record<string, unknown>): ResolvedOption[] {
  const opts = resolveOptions(policy, field);
  if (!field.filterBy) return opts;
  const v = values[field.filterBy];
  if (typeof v !== "string" || !v) return opts;
  return opts.filter((o) => !o.coAuthors || o.coAuthors.includes(v));
}

export function isHidden(field: FieldDef, values: Record<string, unknown>): boolean {
  if (!field.hiddenWhen) return false;
  return Object.entries(field.hiddenWhen).every(([k, v]) => values[k] === v);
}

export function designationLabel(policy: Policy, key: string): string {
  return policy.designations.items.find((d) => d.key === key)?.label ?? key;
}

export function researchStatusLabel(policy: Policy, key: string): string {
  return policy.researchStatuses.find((d) => d.key === key)?.label ?? key;
}

export function optionLabel(policy: Policy, field: FieldDef, value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  return resolveOptions(policy, field).find((o) => o.key === value)?.label ?? value;
}
