import { z } from "zod";

/** Exact decimal value written as a string (or a plain number in YAML). */
export const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), { message: "Must be a number" });

export const signoff = z.enum(["CONFIRMED", "PENDING"]);

const option = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  points: decimalString.optional(),
  eligible: z.boolean().optional(),
  note: z.string().optional(),
  /** PENDING marks a value still awaiting owner sign-off; scored lines using it need Admin review. */
  signoff: signoff.optional(),
});
export type PolicyOption = z.infer<typeof option>;

const fieldType = z.enum(["text", "textarea", "date", "number", "money", "integer", "url", "select", "boolean"]);
export type FieldType = z.infer<typeof fieldType>;

const fieldDef = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  label: z.string(),
  type: fieldType,
  required: z.boolean().optional(),
  min: z.number().optional(),
  options: z.array(option).optional(),
  /** Dotted path to an option list elsewhere in the policy, e.g. `publication.classes`. */
  optionsFrom: z.string().optional(),
  /** Only show options whose `coAuthors` list contains the value of this field. */
  filterBy: z.string().optional(),
  hiddenWhen: z.record(z.string(), z.string()).optional(),
});
export type FieldDef = z.infer<typeof fieldDef>;

const researchSection = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  label: z.string(),
  help: z.string().optional(),
  calc: z.enum(["publication", "lookup", "grant", "zero"]),
  lookupField: z.string().optional(),
  zeroReason: z.string().optional(),
  reviewNote: z.string().optional(),
  /** Only the N highest-scoring entries of this section earn points (e.g. editorships: best 2 journals). */
  maxScoredEntries: z.number().int().positive().optional(),
  fields: z.array(fieldDef).min(1),
});
export type ResearchSection = z.infer<typeof researchSection>;

const keyed = z.object({ key: z.string(), label: z.string() });
const coAuthorScoped = keyed.extend({ coAuthors: z.array(z.string()) });

export const policySchema = z
  .object({
    version: z.string().min(1),
    label: z.string(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency: z.literal("INR"),
    parameters: z.object({
      researchRatePerPoint: decimalString,
      minimumPoints: z.object({ STANDARD: decimalString, JUNIOR: decimalString }),
      prorating: z.object({
        enabled: z.boolean(),
        /**
         * FIXED_DAYS (v1 workbook): (period end − joining) ÷ daysInYear.
         * PERIOD_DAYS (owner decision 2026-11): days in service within the period (joining and exit
         * dates inclusive) ÷ total days in the period. Applies to new and exiting faculty.
         */
        basis: z.enum(["FIXED_DAYS", "PERIOD_DAYS"]).default("FIXED_DAYS"),
        dayCount: z.enum(["END_EXCLUSIVE", "END_INCLUSIVE"]),
        daysInYear: z.number().int().positive(),
        signoff,
        note: z.string().optional(),
      }),
      pointsDecimalPlaces: z.number().int().min(0).max(4),
      paymentRounding: z.enum(["NEAREST_RUPEE", "CEIL_RUPEE", "NONE"]),
      paymentRoundingSignoff: signoff,
      differential: z.enum(["CORRECTED_MINUS_PAID"]),
      /** Informational: consulting revenue split. Not part of RTS points. */
      consultingRevenueShare: z
        .object({ facultyPercent: decimalString, institutionPercent: decimalString, basis: z.string() })
        .optional(),
    }),
    designations: z.object({
      pointRateSignoff: signoff,
      items: z
        .array(
          z.object({
            key: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
            label: z.string(),
            facultyCategory: z.enum(["STANDARD", "JUNIOR"]),
            pointRate: decimalString,
            overloadRatePerHour: decimalString.nullable(),
            cldRatePerHour: decimalString.nullable(),
          }),
        )
        .min(1),
    }),
    researchStatuses: z
      .array(keyed.extend({ contractualLoadHours: z.number(), teachingCapHours: z.number() }))
      .min(1),
    teaching: z.object({
      columns: z
        .array(
          z.object({
            key: z.string().regex(/^[a-z][a-z0-9]*$/),
            label: z.string(),
            signoff: signoff.optional(),
            note: z.string().optional(),
          }),
        )
        .min(1),
      /** Course types with their own points-per-hour rate. Absent → every row uses pointsConversion.pointsPerHour. */
      courseTypes: z
        .array(
          keyed.extend({
            pointsPerHour: decimalString,
            /** Students ÷ sections must reach this for the rate to apply; otherwise the default rate is used. */
            minStudentsPerSection: z.number().int().positive().optional(),
            note: z.string().optional(),
          }),
        )
        .optional(),
      pointsConversion: z.object({
        pointsPerHour: decimalString,
        excludedColumns: z.array(z.string()),
        signoff,
        note: z.string().optional(),
      }),
      newAssistantProfessor: z.object({ contractualLoadHours: z.number(), firstYearsOfService: z.number() }),
      capExcludedColumns: z.array(z.string()),
      cld: z.object({
        showCompensationSeparately: z.boolean(),
        includedInPointsPayment: z.literal(false),
        signoff,
        note: z.string().optional(),
      }),
    }),
    publication: z.object({
      classes: z.array(keyed.extend({ basePoints: decimalString })).min(1),
      paidJournalPoints: decimalString,
      soleAuthor: z.object({ factor: decimalString, signoff, note: z.string().optional() }),
      coAuthorCounts: z.array(keyed),
      contributions: z.array(coAuthorScoped),
      affiliationMixes: z.array(coAuthorScoped),
      contributionMatrix: z.array(
        z
          .object({
            coAuthors: z.string(),
            contribution: z.string(),
            mix: z.string(),
            factor: decimalString.optional(),
            range: z.string().optional(),
          })
          .refine((c) => (c.factor === undefined) !== (c.range === undefined), {
            message: "Each matrix cell needs exactly one of factor or range",
          }),
      ),
    }),
    grant: z.object({
      tiers: z
        .array(
          z.object({
            below: decimalString.optional(),
            upToInclusive: decimalString.optional(),
            points: decimalString,
          }),
        )
        .min(1),
    }),
    researchSections: z.array(researchSection).min(1),
    service: z.object({
      roles: z.array(
        z.object({
          key: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
          group: z.string(),
          label: z.string(),
          points: decimalString,
          quantity: z.enum(["FLAG", "COUNT"]),
          descriptionLabel: z.string().optional(),
          zeroReason: z.string().optional(),
          /** Quantity above this earns no further points (e.g. empirical study guidance: max 10). */
          maxQuantity: z.number().int().positive().optional(),
          signoff: signoff.optional(),
          note: z.string().optional(),
        }),
      ),
      disclosures: z.array(z.object({ key: z.string(), label: z.string(), type: z.enum(["integer", "textarea"]) })),
      disclosureNote: z.string(),
    }),
  })
  .superRefine((p, ctx) => {
    const unique = (keys: string[], where: string) => {
      const seen = new Set<string>();
      for (const k of keys) {
        if (seen.has(k)) ctx.addIssue({ code: "custom", message: `Duplicate key ${k} in ${where}` });
        seen.add(k);
      }
    };
    unique(p.designations.items.map((d) => d.key), "designations");
    unique(p.researchSections.map((s) => s.key), "researchSections");
    unique(p.service.roles.map((r) => r.key), "service.roles");
    for (const s of p.researchSections) {
      if (s.calc === "lookup") {
        const f = s.fields.find((x) => x.key === s.lookupField);
        if (!f || !f.options?.every((o) => o.points !== undefined)) {
          ctx.addIssue({ code: "custom", message: `Section ${s.key}: lookupField must be a select whose options all have points` });
        }
      }
    }
    const cols = new Set(p.teaching.columns.map((c) => c.key));
    for (const k of [...p.teaching.pointsConversion.excludedColumns, ...p.teaching.capExcludedColumns]) {
      if (!cols.has(k)) ctx.addIssue({ code: "custom", message: `Teaching column ${k} is not defined` });
    }
    if (p.teaching.courseTypes) unique(p.teaching.courseTypes.map((c) => c.key), "teaching.courseTypes");
    // Note: the v1 guardrail forbidding a Disciplinary Committee role was lifted by the
    // 2026-11 points revision (Member of Disciplinary Action Committee = 10 points).
  });

export type Policy = z.infer<typeof policySchema>;
