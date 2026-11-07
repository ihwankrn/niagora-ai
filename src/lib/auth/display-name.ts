const MAX_DISPLAY_NAME_LENGTH = 100;

// Public name shown to clients, taken from Supabase user_metadata
// (full_name or name). Never falls back to the email address.
export function displayNameFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const { full_name: fullName, name } = metadata as Record<string, unknown>;
  const value = [fullName, name].find((candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "");
  return value ? value.trim().slice(0, MAX_DISPLAY_NAME_LENGTH) : null;
}
