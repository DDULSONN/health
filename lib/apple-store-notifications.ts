import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Environment,
  SignedDataVerifier,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";

const DEFAULT_BUNDLE_ID = "com.gymtools.somefit";
const DEFAULT_APP_APPLE_ID = 6798241807;

export type VerifiedAppleNotification = {
  environment: Environment.PRODUCTION | Environment.SANDBOX;
  notification: ResponseBodyV2DecodedPayload;
  transaction: JWSTransactionDecodedPayload | null;
  renewal: JWSRenewalInfoDecodedPayload | null;
};

let rootCertificates: Buffer[] | null = null;

function loadAppleRootCertificates() {
  if (rootCertificates) return rootCertificates;

  rootCertificates = ["AppleRootCA-G2.cer", "AppleRootCA-G3.cer"].map((filename) =>
    readFileSync(path.join(process.cwd(), "certs", "apple", filename))
  );
  return rootCertificates;
}

function getBundleId() {
  return process.env.APPLE_IAP_BUNDLE_ID?.trim() || DEFAULT_BUNDLE_ID;
}

function getAppAppleId() {
  const parsed = Number(process.env.APPLE_IAP_APP_ID?.trim() || DEFAULT_APP_APPLE_ID);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("APPLE_IAP_APP_ID must be a positive integer.");
  }
  return parsed;
}

function onlineChecksEnabled() {
  return process.env.APPLE_IAP_ENABLE_ONLINE_CHECKS?.trim().toLowerCase() !== "false";
}

function createVerifier(environment: Environment.PRODUCTION | Environment.SANDBOX) {
  return new SignedDataVerifier(
    loadAppleRootCertificates(),
    onlineChecksEnabled(),
    environment,
    getBundleId(),
    environment === Environment.PRODUCTION ? getAppAppleId() : undefined
  );
}

export async function verifyAppleServerNotification(signedPayload: string): Promise<VerifiedAppleNotification> {
  const payload = signedPayload.trim();
  if (!payload) {
    throw new Error("signedPayload is required.");
  }

  let lastError: unknown = null;
  for (const environment of [Environment.PRODUCTION, Environment.SANDBOX] as const) {
    try {
      const verifier = createVerifier(environment);
      const notification = await verifier.verifyAndDecodeNotification(payload);
      const transaction = notification.data?.signedTransactionInfo
        ? await verifier.verifyAndDecodeTransaction(notification.data.signedTransactionInfo)
        : null;
      const renewal = notification.data?.signedRenewalInfo
        ? await verifier.verifyAndDecodeRenewalInfo(notification.data.signedRenewalInfo)
        : null;

      return { environment, notification, transaction, renewal };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("App Store notification signature verification failed.");
}

export function buildAppleNotificationEventKey(notificationUUID: string | undefined, signedPayload: string) {
  const uuid = notificationUUID?.trim();
  if (uuid) return `ios-notification:${uuid}`;
  return `ios-notification:${createHash("sha256").update(signedPayload).digest("hex")}`;
}
