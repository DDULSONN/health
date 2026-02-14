import fs from "fs";
import path from "path";
import React from "react";
import { getWeightClass } from "@/lib/weightClass";
import type { Sex } from "@/lib/percentile";

type PdfInput = {
  certificateNo: string;
  issuedAt: string;
  nickname: string;
  sexLabel: string;
  bodyweight: number | null;
  squat: number;
  bench: number;
  deadlift: number;
  total: number;
  verificationUrl: string;
  qrDataUrl: string;
};

type PdfLib = typeof import("@react-pdf/renderer");

let pdfLibPromise: Promise<PdfLib> | null = null;
let koreanFontRegistered = false;

function getPdfLib() {
  if (!pdfLibPromise) {
    pdfLibPromise = import("@react-pdf/renderer");
  }
  return pdfLibPromise;
}

function getFontPath(fileName: string) {
  return path.join(process.cwd(), "public", "fonts", fileName);
}

function toDataUri(file: Buffer, mime: string) {
  return `data:${mime};base64,${file.toString("base64")}`;
}

async function registerKoreanFont(lib: PdfLib) {
  if (koreanFontRegistered) return;

  const regularPath = getFontPath("NotoSansKR-Regular.ttf");
  const boldPath = getFontPath("NotoSansKR-Bold.ttf");

  if (!fs.existsSync(regularPath) || !fs.existsSync(boldPath)) {
    throw new Error(
      `Korean font file missing. regular=${regularPath} exists=${fs.existsSync(regularPath)}, bold=${boldPath} exists=${fs.existsSync(boldPath)}`,
    );
  }

  const regular = fs.readFileSync(regularPath);
  const bold = fs.readFileSync(boldPath);

  lib.Font.register({
    family: "NotoSansKR",
    fonts: [
      { src: toDataUri(regular, "font/ttf"), fontWeight: 400 },
      { src: toDataUri(bold, "font/ttf"), fontWeight: 700 },
    ],
  });

  koreanFontRegistered = true;
}

function formatMultiplier(lift: number, bodyweight: number | null): string {
  if (!bodyweight || bodyweight <= 0) return "-";
  return `${(lift / bodyweight).toFixed(2)}x`;
}

function normalizeSex(value: string): Sex {
  return value === "female" ? "female" : "male";
}

function sexKo(value: string) {
  return normalizeSex(value) === "male" ? "남성" : "여성";
}

function strengthGrade(total: number, bodyweight: number | null): string {
  if (!bodyweight || bodyweight <= 0) return "산정 불가";
  const ratio = total / bodyweight;
  if (ratio >= 7) return "LEGEND";
  if (ratio >= 6) return "ELITE";
  if (ratio >= 5) return "ADVANCED";
  if (ratio >= 4) return "INTERMEDIATE";
  if (ratio >= 3) return "NOVICE";
  return "BEGINNER";
}

function createStyles(lib: PdfLib) {
  return lib.StyleSheet.create({
    page: {
      backgroundColor: "#ffffff",
      padding: 24,
      fontFamily: "NotoSansKR",
      color: "#111827",
    },
    frame: {
      borderWidth: 1,
      borderColor: "#d1d5db",
      minHeight: "100%",
      padding: 18,
      position: "relative",
    },
    watermark: {
      position: "absolute",
      top: "44%",
      left: "12%",
      fontSize: 54,
      color: "#111827",
      opacity: 0.05,
      transform: "rotate(-45deg)",
      fontWeight: 700,
      letterSpacing: 2,
    },
    topCenter: {
      alignItems: "center",
      marginBottom: 10,
      gap: 1,
    },
    brand: {
      fontSize: 24,
      fontWeight: 700,
      letterSpacing: 1,
    },
    subtitleEn: {
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 0.8,
    },
    subtitleKo: {
      fontSize: 13,
      marginTop: 2,
      fontWeight: 700,
    },
    certMetaWrap: {
      alignItems: "flex-end",
      marginBottom: 10,
    },
    certMetaText: {
      fontSize: 10,
      lineHeight: 1.6,
      textAlign: "right",
    },
    infoCard: {
      borderWidth: 1,
      borderColor: "#d1d5db",
      borderRadius: 4,
      padding: 10,
      marginBottom: 12,
      backgroundColor: "#fafafa",
    },
    infoGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      rowGap: 6,
    },
    infoItem: {
      width: "50%",
      paddingRight: 8,
    },
    infoLabel: {
      fontSize: 9,
      color: "#6b7280",
      marginBottom: 1,
    },
    infoValue: {
      fontSize: 12,
      fontWeight: 700,
    },
    table: {
      borderWidth: 1,
      borderColor: "#d1d5db",
      marginBottom: 12,
    },
    tableRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: "#e5e7eb",
    },
    tableHeader: {
      backgroundColor: "#f3f4f6",
    },
    cellItem: {
      width: "38%",
      padding: 7,
      fontSize: 10,
    },
    cellRecord: {
      width: "32%",
      padding: 7,
      fontSize: 10,
      textAlign: "right",
    },
    cellMulti: {
      width: "30%",
      padding: 7,
      fontSize: 10,
      textAlign: "right",
    },
    th: {
      fontWeight: 700,
    },
    bottomRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
      marginTop: 8,
    },
    verifyBlock: {
      width: "66%",
    },
    verifyText: {
      fontSize: 9.5,
      lineHeight: 1.4,
      marginBottom: 4,
    },
    committee: {
      marginTop: 8,
      fontSize: 10,
      lineHeight: 1.5,
      fontWeight: 700,
    },
    qrWrap: {
      width: "32%",
      alignItems: "center",
    },
    qr: {
      width: 108,
      height: 108,
      marginBottom: 4,
    },
    qrCaption: {
      fontSize: 8.5,
      textAlign: "center",
      lineHeight: 1.3,
    },
  });
}

function CertificatePdf({
  lib,
  styles,
  input,
}: {
  lib: PdfLib;
  styles: ReturnType<typeof createStyles>;
  input: PdfInput;
}) {
  const { Document, Image, Page, Text, View } = lib;
  const sex = normalizeSex(input.sexLabel);
  const classLabel =
    typeof input.bodyweight === "number" && input.bodyweight > 0
      ? getWeightClass(sex, input.bodyweight)?.label ?? "-"
      : "-";
  const grade = strengthGrade(input.total, input.bodyweight);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.frame}>
          <Text style={styles.watermark}>GYMTOOLS CERTIFIED</Text>

          <View style={styles.topCenter}>
            <Text style={styles.brand}>GYMTOOLS</Text>
            <Text style={styles.subtitleEn}>OFFICIAL STRENGTH CERTIFICATION</Text>
            <Text style={styles.subtitleKo}>3대 합계 공식 인증서</Text>
          </View>

          <View style={styles.certMetaWrap}>
            <Text style={styles.certMetaText}>
              인증번호: {input.certificateNo}
              {"\n"}
              발급일자: {input.issuedAt}
            </Text>
          </View>

          <View style={styles.infoCard}>
            <View style={styles.infoGrid}>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>닉네임</Text>
                <Text style={styles.infoValue}>{input.nickname}</Text>
              </View>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>성별</Text>
                <Text style={styles.infoValue}>{sexKo(input.sexLabel)}</Text>
              </View>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>체중</Text>
                <Text style={styles.infoValue}>
                  {typeof input.bodyweight === "number" && input.bodyweight > 0 ? `${input.bodyweight} kg` : "-"}
                </Text>
              </View>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>체급</Text>
                <Text style={styles.infoValue}>{classLabel}</Text>
              </View>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Strength Grade</Text>
                <Text style={styles.infoValue}>{grade}</Text>
              </View>
            </View>
          </View>

          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={[styles.cellItem, styles.th]}>항목</Text>
              <Text style={[styles.cellRecord, styles.th]}>기록(kg)</Text>
              <Text style={[styles.cellMulti, styles.th]}>체중 대비 배수</Text>
            </View>

            <View style={styles.tableRow}>
              <Text style={styles.cellItem}>스쿼트</Text>
              <Text style={styles.cellRecord}>{input.squat}</Text>
              <Text style={styles.cellMulti}>{formatMultiplier(input.squat, input.bodyweight)}</Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={styles.cellItem}>벤치프레스</Text>
              <Text style={styles.cellRecord}>{input.bench}</Text>
              <Text style={styles.cellMulti}>{formatMultiplier(input.bench, input.bodyweight)}</Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={styles.cellItem}>데드리프트</Text>
              <Text style={styles.cellRecord}>{input.deadlift}</Text>
              <Text style={styles.cellMulti}>{formatMultiplier(input.deadlift, input.bodyweight)}</Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.cellItem, styles.th]}>합계</Text>
              <Text style={[styles.cellRecord, styles.th]}>{input.total}</Text>
              <Text style={[styles.cellMulti, styles.th]}>{formatMultiplier(input.total, input.bodyweight)}</Text>
            </View>
          </View>

          <View style={styles.bottomRow}>
            <View style={styles.verifyBlock}>
              <Text style={styles.verifyText}>검증 URL: {input.verificationUrl}</Text>
              <Text style={styles.verifyText}>
                본 인증서는 제출된 영상 자료를 운영자가 확인 후 발급되었습니다.
              </Text>
              <Text style={styles.committee}>GymTools 인증위원회{"\n"}Chief Verifier</Text>
            </View>

            <View style={styles.qrWrap}>
              <Image style={styles.qr} src={input.qrDataUrl} />
              <Text style={styles.qrCaption}>보안 검증용 QR{"\n"}위변조 여부를 확인하세요.</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderCertificatePdfBuffer(input: PdfInput): Promise<Buffer> {
  const lib = await getPdfLib();

  if (!input.qrDataUrl || !input.qrDataUrl.startsWith("data:image")) {
    throw new Error("[qr_generate] Invalid QR data URL");
  }

  await registerKoreanFont(lib);

  try {
    const styles = createStyles(lib);
    const doc = <CertificatePdf lib={lib} styles={styles} input={input} />;
    return await lib.renderToBuffer(doc);
  } catch (renderError) {
    console.error("[cert-pdf] PDF render failed", {
      message: renderError instanceof Error ? renderError.message : String(renderError),
      stack: renderError instanceof Error ? renderError.stack : undefined,
    });
    throw renderError;
  }
}
