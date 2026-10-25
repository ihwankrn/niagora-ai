/**
 * Kontrak tipe yang disinkronkan dengan branch Backend (src/lib/contracts/briefs.ts, common.ts, errors.ts).
 * Menjaga keselarasan data antara Frontend dan Backend Niagora AI.
 */

export const SERVICE_TYPES = [
  "web_development",
  "graphic_design",
  "content_writing",
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

export const BRIEF_MIN_LENGTH = 20;
export const BRIEF_MAX_LENGTH = 10_000;

// Request body untuk POST /api/briefs/analyze
export interface AnalyzeBriefRequest {
  brief: string;
  serviceType: ServiceType;
}

// Item deliverable hasil dekonstruksi server
export interface DeliverableItem {
  id: string; // UUID dibuat server
  title: string;
  description: string;
  estimatedHours: number;
}

// Objek analisis yang dihasilkan engine AI backend
export interface BriefAnalysis {
  summary: string;
  deliverables: DeliverableItem[];
  clarificationQuestions: string[];
  assumptions: string[];
}

// Response sukses dari POST /api/briefs/analyze
export interface AnalyzeBriefResponse {
  briefId: string;
  serviceType: ServiceType;
  analysis: BriefAnalysis;
  totalEstimatedHours: number;
  createdAt: string;
}

// Error codes standar API backend
export type ApiErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "AI_UNAVAILABLE"
  | "PAYMENT_PROVIDER_ERROR"
  | "INTERNAL_ERROR";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ValidationIssue[];
  };
}

export interface ApiSuccessBody<T> {
  data: T;
}

// Alias untuk kemudahan komponen frontend
export type AnalysisResult = AnalyzeBriefResponse;
