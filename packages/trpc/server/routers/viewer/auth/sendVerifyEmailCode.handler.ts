import { sendEmailVerificationByCode } from "@calcom/features/auth/lib/verifyEmail";
import { getEventTypeService } from "@calcom/features/eventtypes/di/EventTypeService.container";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import getIP from "@calcom/lib/getIP";
import { hashEmail, piiHasher } from "@calcom/lib/server/PiiHasher";
import { prisma } from "@calcom/prisma";
import { verificationEmailBrandingSchema } from "@calcom/prisma/zod-utils";
import type { NextApiRequest } from "next";
import type { TRPCContext } from "../../../createContext";
import type { TSendVerifyEmailCodeSchema } from "./sendVerifyEmailCode.schema";

type SendVerifyEmailCode = {
  input: TSendVerifyEmailCodeSchema;
  req: TRPCContext["req"] | undefined;
};

export const sendVerifyEmailCodeHandler = async ({ input, req }: SendVerifyEmailCode) => {
  const identifier = req ? piiHasher.hash(getIP(req as NextApiRequest)) : hashEmail(input.email);
  return sendVerifyEmailCode({ input, identifier });
};

export const sendVerifyEmailCode = async ({
  input,
  identifier,
}: {
  input: TSendVerifyEmailCodeSchema;
  identifier: string;
}) => {
  await checkRateLimitAndThrowError({
    rateLimitingType: "core",
    identifier: `sendVerifyEmailCode:${identifier}`,
  });

  let hideBranding = false;
  let verificationEmailBranding: { label: string } | undefined;
  if (input.eventTypeId && Number.isSafeInteger(input.eventTypeId) && input.eventTypeId > 0) {
    try {
      hideBranding = await getEventTypeService().shouldHideBrandingForEventType(input.eventTypeId);
      const event =
        !input.isVerifyingEmail &&
        (await prisma.eventType.findUnique({
          where: { id: input.eventTypeId },
          select: { metadata: true, hidden: true, bookingRequiresAuthentication: true, schedulingType: true },
        }));
      if (
        event &&
        !event.hidden &&
        !event.bookingRequiresAuthentication &&
        event.schedulingType !== "MANAGED"
      ) {
        const metadata = event.metadata;
        const branding = verificationEmailBrandingSchema.safeParse(
          metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? metadata.verificationEmailBranding
            : undefined
        );
        if (branding.success) verificationEmailBranding = branding.data;
      }
    } catch {
      // Event context is optional; lookup failures must never select another event's branding.
      hideBranding = false;
    }
  }

  return await sendEmailVerificationByCode({
    email: input.email,
    username: input.username,
    language: input.language,
    isVerifyingEmail: input.isVerifyingEmail,
    hideBranding,
    verificationEmailBranding,
  });
};
