import { describe, expect, it } from "vitest";

import { displayNameFromMetadata } from "./display-name";

describe("displayNameFromMetadata", () => {
  it("prefers full_name, then name, trimmed", () => {
    expect(displayNameFromMetadata({ full_name: "  Ahmad Rasidi ", name: "rasidi" })).toBe("Ahmad Rasidi");
    expect(displayNameFromMetadata({ name: "Rasidi" })).toBe("Rasidi");
    expect(displayNameFromMetadata({ full_name: "   ", name: "Rasidi" })).toBe("Rasidi");
  });

  it("returns null instead of falling back to the email", () => {
    expect(displayNameFromMetadata({ email: "freelancer@example.com" })).toBeNull();
    expect(displayNameFromMetadata(undefined)).toBeNull();
    expect(displayNameFromMetadata({ full_name: 42 })).toBeNull();
  });

  it("caps the length", () => {
    expect(displayNameFromMetadata({ full_name: "x".repeat(500) })).toHaveLength(100);
  });
});
