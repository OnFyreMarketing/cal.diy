import type { EmailVerifyCode } from "@calcom/emails/lib/types/email-types";
import { VerifyEmailByCode } from "@calcom/emails/src/templates/VerifyEmailByCode";
import AttendeeVerifyEmail from "@calcom/emails/templates/attendee-verify-email";
import { APP_NAME, COMPANY_NAME } from "@calcom/lib/constants";
import { decodeHTML } from "entities";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendVerifyEmailCode } from "./sendVerifyEmailCode.handler";
import { ZSendVerifyEmailCodeSchema } from "./sendVerifyEmailCode.schema";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  hideBranding: vi.fn(),
  sendCode: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@calcom/prisma", () => ({ prisma: { eventType: { findUnique: mocks.findUnique } } }));
vi.mock("@calcom/features/eventtypes/di/EventTypeService.container", () => ({
  getEventTypeService: () => ({ shouldHideBrandingForEventType: mocks.hideBranding }),
}));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({
  checkRateLimitAndThrowError: mocks.rateLimit,
}));
vi.mock("@calcom/emails/auth-email-service", () => ({
  sendEmailVerificationCode: mocks.sendCode,
  sendEmailVerificationLink: vi.fn(),
  sendChangeOfEmailVerificationLink: vi.fn(),
}));
vi.mock("@calcom/features/watchlist/operations/check-if-email-in-watchlist.controller", () => ({
  checkIfEmailIsBlockedInWatchlistController: vi.fn().mockResolvedValue(false),
}));
vi.mock("@calcom/i18n/server", async () => {
  const { createInstance } = await import("i18next");
  const { default: en } = await import("@calcom/i18n/locales/en/common.json");
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en: { common: en } }, defaultNS: "common" });
  return { getTranslation: async () => i18n.getFixedT("en", "common") };
});
vi.mock("@calcom/emails/src/renderEmail", () => ({
  default: async (_template: string, props: EmailVerifyCode) =>
    renderToStaticMarkup(VerifyEmailByCode(props)),
}));
vi.mock("@calcom/emails/templates/_base-email", () => ({
  default: class {
    name = "";
    getMailerOptions() {
      return { from: "platform@example.invalid" };
    }
  },
}));

class InspectableEmail extends AttendeeVerifyEmail {
  payload() {
    return this.getNodeMailerPayload();
  }
}

const label = "OptiMES Prime / Blum Informatik";
const request = { email: "booker@example.invalid", username: "Booker", language: "en" };
const publicEvent = (metadata: unknown) => ({
  metadata,
  hidden: false,
  bookingRequiresAuthentication: false,
  schedulingType: null,
});
async function send(eventTypeId?: number, extra: Record<string, unknown> = {}) {
  await sendVerifyEmailCode({ input: { ...request, eventTypeId, ...extra }, identifier: "synthetic" });
  const input = mocks.sendCode.mock.lastCall?.[0] as EmailVerifyCode;
  return { input, payload: await new InspectableEmail(input).payload() };
}

describe("booking verification email branding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hideBranding.mockResolvedValue(false);
    mocks.findUnique.mockResolvedValue(publicEvent(null));
  });

  it("uses only the resolved event label in subject, visible HTML and text", async () => {
    mocks.findUnique.mockResolvedValue(publicEvent({ verificationEmailBranding: { label: `  ${label}  ` } }));
    const { input, payload } = await send(5);
    expect(input.verificationEmailBranding).toEqual({ label });
    expect(payload.subject).toBe(
      `${input.language("verify_email_subject", { appName: APP_NAME })} — ${label}`
    );
    expect(payload.html).toContain(`<p>${label}</p>`);
    expect(payload.text).toContain(label);
    expect(payload.from).toBeDefined();
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      select: { metadata: true, hidden: true, bookingRequiresAuthentication: true, schedulingType: true },
    });
  });

  it.each([
    null,
    {},
  ])("preserves the exact generic subject and text for absent metadata %j", async (metadata) => {
    mocks.findUnique.mockResolvedValue(publicEvent(metadata));
    const { input, payload } = await send(5);
    const subject = input.language("verify_email_subject", { appName: APP_NAME });
    expect(input.verificationEmailBranding).toBeUndefined();
    expect(payload.subject).toBe(subject);
    expect(payload.text).toBe(
      `
${subject}
${input.language("verify_email_email_header")}
${input.language("hi_user_name", { name: request.username })},
${input.language("verify_email_by_code_email_body")}
${input.verificationEmailCode}
${input.language("happy_scheduling")} ${input.language("the_calcom_team", { companyName: COMPANY_NAME })}
`.replace(/(<([^>]+)>)/gi, "")
    );
    expect(payload.html).not.toContain(label);
  });

  it("does not inherit branding across events or from a previous request", async () => {
    mocks.findUnique.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(publicEvent(where.id === 5 ? { verificationEmailBranding: { label } } : null))
    );
    expect((await send(5)).payload.subject).toContain(label);
    const other = await send(6);
    expect(other.input.verificationEmailBranding).toBeUndefined();
    expect(JSON.stringify(other.payload)).not.toContain(label);
  });

  it("strips client branding and ignores injected fields even on direct invocation", async () => {
    const forged = { verificationEmailBranding: { label: "Foreign label" }, label: "Foreign label" };
    expect(ZSendVerifyEmailCodeSchema.parse({ ...request, eventTypeId: 6, ...forged })).toEqual({
      ...request,
      eventTypeId: 6,
    });
    const { payload } = await send(6, forged);
    expect(JSON.stringify(payload)).not.toContain("Foreign label");
    mocks.findUnique.mockResolvedValue(publicEvent({ verificationEmailBranding: { label } }));
    expect((await send(5, forged)).payload.subject).toContain(label);
  });

  it.each([
    null,
    {},
    { label: "" },
    { label: "   " },
    { label: "x".repeat(121) },
    { label: "bad\r\nSubject" },
    { label: "\nleading" },
    { label: "trailing\n" },
    { label: "bad\u0000" },
    { label: "bad\u0085" },
    { label: "bad\u2028" },
    { label: "bad\u2029" },
    { label: 42 },
  ])("falls back safely for malformed branding %#", async (branding) => {
    mocks.findUnique.mockResolvedValue(publicEvent({ verificationEmailBranding: branding }));
    const { input, payload } = await send(5);
    expect(input.verificationEmailBranding).toBeUndefined();
    expect(payload.subject).toBe(input.language("verify_email_subject", { appName: APP_NAME }));
  });

  it.each([
    undefined,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("does not resolve invalid event id %s", async (id) => {
    expect((await send(id)).input.verificationEmailBranding).toBeUndefined();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...publicEvent({ verificationEmailBranding: { label } }), hidden: true },
    { ...publicEvent({ verificationEmailBranding: { label } }), bookingRequiresAuthentication: true },
    { ...publicEvent({ verificationEmailBranding: { label } }), schedulingType: "MANAGED" },
  ])("does not brand missing or ineligible event context %#", async (event) => {
    mocks.findUnique.mockResolvedValue(event);
    expect((await send(5)).input.verificationEmailBranding).toBeUndefined();
  });

  it("uses a generic fallback when event resolution fails", async () => {
    mocks.findUnique.mockRejectedValueOnce(new Error("synthetic lookup failure"));
    expect((await send(5)).input.verificationEmailBranding).toBeUndefined();
  });

  it("keeps account code verification generic even with an event id", async () => {
    mocks.findUnique.mockResolvedValue(publicEvent({ verificationEmailBranding: { label } }));
    const { input, payload } = await send(5, { isVerifyingEmail: true });
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(input.verificationEmailBranding).toBeUndefined();
    expect(payload.subject).toBe(
      input.language("verify_email_subject_verifying_email", { appName: APP_NAME })
    );
  });

  it("preserves the existing hide-branding option", async () => {
    mocks.hideBranding.mockResolvedValue(true);
    const { input, payload } = await send(5);
    expect(input.hideLogo).toBe(true);
    expect(payload.subject).toBe(input.language("verify_email_subject_no_branding"));
  });

  it("escapes HTML while retaining the literal label in subject and text", async () => {
    const literal = "OptiMES <Prime> & Blum";
    mocks.findUnique.mockResolvedValue(publicEvent({ verificationEmailBranding: { label: literal } }));
    const { payload } = await send(5);
    expect(decodeHTML(String(payload.subject))).toContain(literal);
    expect(payload.text).toContain(literal);
    expect(payload.html).toContain("<p>OptiMES &lt;Prime&gt; &amp; Blum</p>");
  });

  it("still enforces rate limiting before event resolution or sending", async () => {
    mocks.rateLimit.mockRejectedValueOnce(new Error("synthetic rate limit"));
    await expect(send(5)).rejects.toThrow("synthetic rate limit");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.sendCode).not.toHaveBeenCalled();
  });

  it("keeps entity-encoded controls literal at the actual subject decoding boundary", async () => {
    const literal = "OptiMES &#10; &#13; &NewLine; Blum";
    mocks.findUnique.mockResolvedValue(publicEvent({ verificationEmailBranding: { label: literal } }));
    const { payload } = await send(5);
    const deliveredSubject = decodeHTML(String(payload.subject));
    expect(deliveredSubject).toContain(literal);
    expect(deliveredSubject).not.toMatch(/[\r\n]/);
    expect(payload.text).toContain(literal);
    expect(payload.html).toContain("<p>OptiMES &amp;#10; &amp;#13; &amp;NewLine; Blum</p>");
  });
});
