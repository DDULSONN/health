import { randomUUID } from "crypto";

export type CertSex = "male" | "female";

export type CertRequestRecord = {
  id: string;
  user_id: string;
  nickname: string | null;
  email: string | null;
  sex: CertSex;
  bodyweight: number | null;
  squat: number;
  bench: number;
  deadlift: number;
  total: number;
  submit_code: string;
  status: "pending" | "needs_info" | "rejected" | "approved";
  note: string | null;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export function normalizeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function makeSubmitCode(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `GTC-${y}${m}${d}-${suffix}`;
}

export function makeCertificateSlug(): string {
  return randomUUID().replace(/-/g, "").slice(0, 14);
}

export async function makeQrDataUrl(verificationUrl: string): Promise<string> {
  const qrcode = await import("qrcode");
  return qrcode.toDataURL(verificationUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 220,
  });
}
