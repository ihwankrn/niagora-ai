import "server-only";

import { analyzeBrief } from "@/lib/ai/brief-analyzer";
import { ApiError } from "@/lib/api/http";
import type { AuthUser } from "@/lib/auth/session";
import type { AnalyzeBriefRequest, AnalyzeBriefResponse } from "@/lib/contracts/briefs";
import type { ServiceType } from "@/lib/contracts/common";
import { prisma } from "@/lib/db";
import type { ServiceType as DbServiceType } from "@/generated/prisma/client";

// Each analysis is a paid LLM call, so cap it per user.
export const MAX_ANALYSES_PER_HOUR = 20;

const DB_SERVICE_TYPES: Record<ServiceType, DbServiceType> = {
  web_development: "WEB_DEVELOPMENT",
  graphic_design: "GRAPHIC_DESIGN",
  content_writing: "CONTENT_WRITING",
};

// Stores the brief first so failed attempts are recorded and count toward the
// limit. The row lock on the user serializes each user's check and insert, so
// concurrent requests cannot all read a count below the limit.
export async function createBriefWithinLimit(user: AuthUser, input: AnalyzeBriefRequest) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
    const recent = await tx.brief.count({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recent >= MAX_ANALYSES_PER_HOUR) {
      throw new ApiError("RATE_LIMITED", "Too many briefs analyzed in the last hour. Please try again later.");
    }
    return tx.brief.create({
      data: { userId: user.id, serviceType: DB_SERVICE_TYPES[input.serviceType], rawText: input.brief },
    });
  });
}

export async function analyzeAndStoreBrief(user: AuthUser, input: AnalyzeBriefRequest): Promise<AnalyzeBriefResponse> {
  const brief = await createBriefWithinLimit(user, input);

  let result;
  try {
    result = await analyzeBrief(input);
  } catch (error) {
    await prisma.brief.update({ where: { id: brief.id }, data: { status: "FAILED" } });
    throw error;
  }

  await prisma.brief.update({
    where: { id: brief.id },
    data: { status: "ANALYZED", analysis: result.analysis, aiModel: result.model },
  });

  return {
    briefId: brief.id,
    serviceType: input.serviceType,
    analysis: result.analysis,
    totalEstimatedHours: result.totalEstimatedHours,
    createdAt: brief.createdAt.toISOString(),
  };
}
