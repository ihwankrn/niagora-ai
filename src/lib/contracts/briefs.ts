import { z } from "zod";

import { hoursSchema, isoDateTimeSchema, serviceTypeSchema, uuidSchema } from "./common";

export const BRIEF_MIN_LENGTH = 20;
export const BRIEF_MAX_LENGTH = 10_000;

// POST /api/briefs/analyze
export const analyzeBriefRequestSchema = z.strictObject({
  brief: z.string().trim().min(BRIEF_MIN_LENGTH).max(BRIEF_MAX_LENGTH),
  serviceType: serviceTypeSchema,
});
export type AnalyzeBriefRequest = z.infer<typeof analyzeBriefRequestSchema>;

// Structured output of the analysis. It never contains prices: pricing is
// decided by the freelancer's rate and computed by the quote engine.
export const deliverableSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000),
  estimatedHours: hoursSchema,
});
export type Deliverable = z.infer<typeof deliverableSchema>;

export const briefAnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(2_000),
  deliverables: z.array(deliverableSchema).min(1).max(30),
  clarifyingQuestions: z.array(z.string().trim().min(1).max(500)).max(15),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(15),
});
export type BriefAnalysis = z.infer<typeof briefAnalysisSchema>;

export const analyzeBriefResponseSchema = z.object({
  briefId: uuidSchema,
  serviceType: serviceTypeSchema,
  analysis: briefAnalysisSchema,
  // Sum of deliverables[].estimatedHours, computed on the server.
  totalEstimatedHours: z.number().nonnegative(),
  createdAt: isoDateTimeSchema,
});
export type AnalyzeBriefResponse = z.infer<typeof analyzeBriefResponseSchema>;
