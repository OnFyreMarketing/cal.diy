import { describe, expect, it } from "vitest";
import z from "zod";
import {
  EventTypeMetaDataSchema,
  excludeOrRequireEmailSchema,
  verificationEmailBrandingSchema,
} from "./zod-utils";

describe("excludeOrRequireEmailSchema", () => {
  const parse = (input: string) => z.object({ v: excludeOrRequireEmailSchema }).safeParse({ v: input });

  describe("valid inputs", () => {
    it("accepts single TLD domains", () => {
      expect(parse("gmail.com").success).toBe(true);
    });

    it("accepts uppercase domains", () => {
      expect(parse("GMAIL.COM").success).toBe(true);
    });

    it("accepts multi-level TLD domains (co.uk)", () => {
      expect(parse("hotmail.co.uk").success).toBe(true);
    });

    it("accepts multi-level TLD domains (k12.us)", () => {
      expect(parse("mail.school.k12.us").success).toBe(true);
    });

    it("accepts full email addresses", () => {
      expect(parse("user@example.co.uk").success).toBe(true);
    });

    it("accepts @domain format", () => {
      expect(parse("@example.co.uk").success).toBe(true);
    });

    it("accepts multiple comma-separated entries", () => {
      expect(parse("gmail.com, @example.com, user@example.co.uk").success).toBe(true);
    });

    it("accepts domains with trailing comma (ignores empty entry)", () => {
      expect(parse("gmail.com, hotmail.co.uk,").success).toBe(true);
    });

    it("accepts domains with extra spaces", () => {
      expect(parse("  gmail.com  ,  hotmail.co.uk  ").success).toBe(true);
    });

    it("accepts domains with numbers and hyphens", () => {
      expect(parse("example123.com").success).toBe(true);
      expect(parse("my-domain.com").success).toBe(true);
    });

    it("accepts very short domains (min 2-char TLD)", () => {
      expect(parse("a.co").success).toBe(true);
    });

    it("accepts long multi-level domains", () => {
      expect(parse("example.co.uk.test.com").success).toBe(true);
    });

    it("accepts single-label domains and missing dots", () => {
      expect(parse("example").success).toBe(true);
      expect(parse("@example").success).toBe(true);
    });
  });

  describe("invalid inputs", () => {
    it("rejects invalid TLD lengths", () => {
      expect(parse("example.c").success).toBe(false);
    });

    it("rejects leading/trailing hyphens in labels", () => {
      expect(parse("-bad.com").success).toBe(false);
      expect(parse("bad-.com").success).toBe(false);
    });

    it("rejects leading/trailing dots and consecutive dots", () => {
      expect(parse(".bad.com").success).toBe(false);
      expect(parse("bad.com.").success).toBe(false);
      expect(parse("ex..ample.com").success).toBe(false);
    });

    it("allows empty input but rejects commas-only", () => {
      expect(parse("").success).toBe(true);
      expect(parse("   ").success).toBe(true);
      expect(parse(",,,").success).toBe(false);
    });

    it("rejects Unicode domains (ASCII-only)", () => {
      expect(parse("münchen.de").success).toBe(false);
    });
  });
});

describe("verification email branding metadata", () => {
  it("trims and bounds a valid label without changing existing schema fields", () => {
    const original = {
      multipleDuration: [15, 30],
      disableSuccessPage: true,
      disableStandardEmails: { all: { host: true, attendee: false } },
      config: { useHostSchedulesForTeamEvent: true },
      apps: { syntheticApp: { enabled: true, existingSetting: "preserved" } },
    };
    const parsed = EventTypeMetaDataSchema.parse({
      ...original,
      verificationEmailBranding: { label: "  OptiMES Prime / Blum Informatik  " },
    });
    expect(parsed).toEqual({
      ...original,
      verificationEmailBranding: { label: "OptiMES Prime / Blum Informatik" },
    });
    expect(verificationEmailBrandingSchema.parse({ label: "x".repeat(120) }).label).toHaveLength(120);
    expect(verificationEmailBrandingSchema.safeParse({ label: "x".repeat(121) }).success).toBe(false);
    expect(EventTypeMetaDataSchema.parse(original)).toEqual(original);
    expect(EventTypeMetaDataSchema.parse(null)).toBeNull();
  });

  it("discards malformed legacy branding without breaking unrelated metadata", () => {
    expect(
      EventTypeMetaDataSchema.parse({
        multipleDuration: [30],
        verificationEmailBranding: { label: "bad\nlabel" },
      })
    ).toEqual({ multipleDuration: [30], verificationEmailBranding: undefined });
  });
});
