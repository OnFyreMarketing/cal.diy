import { Prisma } from "@calcom/prisma/client";
import { describe, expect, it } from "vitest";
import { getMetadataForUpdate } from "./update.handler";
import { ZUpdateInputSchema } from "./update.schema";

describe("update.handler", () => {
  describe("bookingFields null to Prisma.DbNull transformation", () => {
    function transformBookingFields(
      bookingFields: null | undefined | Prisma.InputJsonValue
    ): typeof Prisma.DbNull | Prisma.InputJsonValue | undefined {
      return bookingFields === null ? Prisma.DbNull : (bookingFields as Prisma.InputJsonValue | undefined);
    }

    it("should convert null to Prisma.DbNull", () => {
      const result = transformBookingFields(null);
      expect(result).toBe(Prisma.DbNull);
    });

    it("should pass through undefined as-is", () => {
      const result = transformBookingFields(undefined);
      expect(result).toBeUndefined();
    });

    it("should pass through an array of booking fields as-is", () => {
      const bookingFieldsArray = [
        {
          name: "email",
          type: "email",
          label: "Email",
          required: true,
          hidden: false,
        },
        {
          name: "name",
          type: "name",
          label: "Name",
          required: true,
          hidden: false,
        },
      ];

      const result = transformBookingFields(bookingFieldsArray);
      expect(result).toEqual(bookingFieldsArray);
    });

    it("should pass through an empty array as-is", () => {
      const result = transformBookingFields([]);
      expect(result).toEqual([]);
    });

    it("should distinguish between null and empty array", () => {
      const nullResult = transformBookingFields(null);
      const emptyArrayResult = transformBookingFields([]);

      expect(nullResult).toBe(Prisma.DbNull);
      expect(emptyArrayResult).toEqual([]);
      expect(nullResult).not.toEqual(emptyArrayResult);
    });
  });
});

describe("verification branding metadata updates", () => {
  const saved = {
    multipleDuration: [15, 30],
    apps: { syntheticApp: { enabled: true, settings: { value: "preserved" } } },
    config: { useHostSchedulesForTeamEvent: true, legacyFlag: "preserved" },
    unknownLegacyEntry: { nested: ["preserved"] },
  };
  const branding = { label: "OptiMES Prime / Blum Informatik" };

  it("preserves all saved JSON when adding branding through the actual update schema", () => {
    const input = ZUpdateInputSchema.parse({
      id: 5,
      metadata: { verificationEmailBranding: { label: `  ${branding.label}  ` } },
    });
    expect(getMetadataForUpdate(saved, input.metadata)).toEqual({
      ...saved,
      verificationEmailBranding: branding,
    });
    expect(saved).not.toHaveProperty("verificationEmailBranding");
  });

  it("retains saved branding and other JSON when an older client omits the new field", () => {
    const existing = { ...saved, verificationEmailBranding: branding };
    const input = ZUpdateInputSchema.parse({ id: 5, metadata: { disableSuccessPage: true } });
    expect(getMetadataForUpdate(existing, input.metadata)).toEqual({ ...existing, disableSuccessPage: true });
  });

  it("preserves existing update semantics on other events and explicit null or omission", () => {
    expect(getMetadataForUpdate(saved, undefined)).toBeUndefined();
    expect(getMetadataForUpdate(saved, null)).toBe(Prisma.DbNull);
    expect(getMetadataForUpdate(saved, { disableSuccessPage: true })).toEqual({ disableSuccessPage: true });
    expect(getMetadataForUpdate(null, { verificationEmailBranding: branding })).toEqual({
      verificationEmailBranding: branding,
    });
  });

  it("does not replace saved branding with invalid input", () => {
    const input = ZUpdateInputSchema.parse({
      id: 5,
      metadata: { verificationEmailBranding: { label: "bad\r\n" } },
    });
    expect(input.metadata?.verificationEmailBranding).toBeUndefined();
    expect(getMetadataForUpdate({ ...saved, verificationEmailBranding: branding }, input.metadata)).toEqual({
      ...saved,
      verificationEmailBranding: branding,
    });
  });

  it("preserves nested stored config and siblings while applying parsed updates", () => {
    const input = ZUpdateInputSchema.parse({
      id: 5,
      metadata: {
        verificationEmailBranding: { label: "  Updated event label  " },
        config: { useHostSchedulesForTeamEvent: false, injectedClientFlag: true },
        injectedClientEntry: { value: "must not persist" },
      },
    });
    expect(input.metadata?.config).toEqual({ useHostSchedulesForTeamEvent: false });
    expect(input.metadata).not.toHaveProperty("injectedClientEntry");
    expect(getMetadataForUpdate(saved, input.metadata)).toEqual({
      ...saved,
      config: { useHostSchedulesForTeamEvent: false, legacyFlag: "preserved" },
      verificationEmailBranding: { label: "Updated event label" },
    });
    expect(saved.config.useHostSchedulesForTeamEvent).toBe(true);
  });

  it("merges deeper object settings and replaces arrays instead of merging their elements", () => {
    const existing = {
      ...saved,
      verificationEmailBranding: branding,
      disableStandardEmails: { all: { host: true, attendee: true }, confirmation: { host: true } },
    };
    const input = ZUpdateInputSchema.parse({
      id: 5,
      metadata: { multipleDuration: [45], disableStandardEmails: { all: { attendee: false } } },
    });
    expect(getMetadataForUpdate(existing, input.metadata)).toEqual({
      ...existing,
      multipleDuration: [45],
      disableStandardEmails: { all: { host: true, attendee: false }, confirmation: { host: true } },
    });
  });

  it("changes branding and removes it explicitly without clearing sibling metadata", () => {
    const existing = { ...saved, verificationEmailBranding: branding };
    const changed = ZUpdateInputSchema.parse({
      id: 5,
      metadata: { verificationEmailBranding: { label: "Changed label" } },
    });
    expect(getMetadataForUpdate(existing, changed.metadata)).toEqual({
      ...saved,
      verificationEmailBranding: { label: "Changed label" },
    });
    const removed = ZUpdateInputSchema.parse({ id: 5, metadata: { verificationEmailBranding: null } });
    expect(removed.metadata?.verificationEmailBranding).toBeNull();
    expect(getMetadataForUpdate(existing, removed.metadata)).toEqual(saved);
    expect(getMetadataForUpdate(saved, removed.metadata)).toEqual(saved);
  });

  it("retains explicit undefined resets for other metadata fields", () => {
    const input = ZUpdateInputSchema.parse({
      id: 5,
      metadata: { multipleDuration: undefined },
    });
    const result = getMetadataForUpdate({ ...saved, verificationEmailBranding: branding }, input.metadata);
    expect(result).not.toHaveProperty("multipleDuration");
    expect(result).toMatchObject({
      config: saved.config,
      verificationEmailBranding: branding,
    });
  });
});
