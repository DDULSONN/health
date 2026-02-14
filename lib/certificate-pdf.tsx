import fs from "fs";
import path from "path";
import React from "react";

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

function createStyles(lib: PdfLib, fontFamily: string) {
  return lib.StyleSheet.create({
    page: {
      padding: 36,
      backgroundColor: "#ffffff",
      fontSize: 11,
      color: "#111827",
      fontFamily,
    },
    title: {
      fontSize: 24,
      fontWeight: 700,
      marginBottom: 12,
      textAlign: "center",
    },
    topRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 14,
    },
    topMeta: {
      fontSize: 11,
      lineHeight: 1.5,
    },
    infoBox: {
      borderWidth: 1,
      borderColor: "#d1d5db",
      borderRadius: 4,
      padding: 10,
      marginBottom: 12,
    },
    infoRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    infoLabel: { color: "#374151" },
    infoValue: { fontWeight: 700 },
    table: {
      borderWidth: 1,
      borderColor: "#d1d5db",
    },
    tableRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: "#e5e7eb",
    },
    th: {
      flex: 1,
      padding: 7,
      backgroundColor: "#f3f4f6",
      fontWeight: 700,
    },
    td: {
      flex: 1,
      padding: 7,
    },
    footer: {
      marginTop: 18,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
    },
    verifyText: {
      maxWidth: 360,
      fontSize: 10,
      lineHeight: 1.4,
    },
    note: {
      marginTop: 6,
      fontSize: 9,
      color: "#4b5563",
    },
    qrWrap: {
      alignItems: "center",
    },
    qr: {
      width: 118,
      height: 118,
      marginBottom: 4,
    },
  });
}

function sexKo(value: string) {
  return value === "male" ? "남성" : "여성";
}

function sexEn(value: string) {
  return value === "male" ? "Male" : "Female";
}

type Labels = {
  title: string;
  topLeft: string;
  certNo: string;
  issuedAt: string;
  nickname: string;
  sex: string;
  bodyweight: string;
  item: string;
  recordKg: string;
  squat: string;
  bench: string;
  deadlift: string;
  total: string;
  verify: string;
  issuer: string;
  note: string;
  qr: string;
};

function createLabels(fallbackAscii: boolean): Labels {
  if (fallbackAscii) {
    return {
      title: "Official Total Lift Certificate",
      topLeft: "GymTools Official Certificate",
      certNo: "Certificate No",
      issuedAt: "Issued",
      nickname: "Nickname",
      sex: "Sex",
      bodyweight: "Bodyweight",
      item: "Item",
      recordKg: "Record (kg)",
      squat: "Squat",
      bench: "Bench Press",
      deadlift: "Deadlift",
      total: "Total",
      verify: "Verify",
      issuer: "Issuer",
      note: "Issued after admin review of submitted lifting evidence.",
      qr: "QR Verify",
    };
  }

  return {
    title: "3대 합계 공식 인증서",
    topLeft: "GymTools Official Certificate",
    certNo: "인증번호",
    issuedAt: "발급일",
    nickname: "닉네임",
    sex: "성별",
    bodyweight: "체중",
    item: "항목",
    recordKg: "기록(kg)",
    squat: "스쿼트",
    bench: "벤치프레스",
    deadlift: "데드리프트",
    total: "합계",
    verify: "검증",
    issuer: "발급기관",
    note: "본 인증서는 제출된 영상 자료를 운영자가 확인 후 발급되었습니다.",
    qr: "QR 검증",
  };
}

function CertificatePdf({
  lib,
  styles,
  labels,
  input,
  fallbackAscii,
}: {
  lib: PdfLib;
  styles: ReturnType<typeof createStyles>;
  labels: Labels;
  input: PdfInput;
  fallbackAscii: boolean;
}) {
  const { Document, Image, Page, Text, View } = lib;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{labels.title}</Text>

        <View style={styles.topRow}>
          <Text style={styles.topMeta}>{labels.topLeft}</Text>
          <Text style={styles.topMeta}>
            {labels.certNo}: {input.certificateNo}
            {"\n"}
            {labels.issuedAt}: {input.issuedAt}
          </Text>
        </View>

        <View style={styles.infoBox}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{labels.nickname}</Text>
            <Text style={styles.infoValue}>{input.nickname}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{labels.sex}</Text>
            <Text style={styles.infoValue}>{fallbackAscii ? sexEn(input.sexLabel) : sexKo(input.sexLabel)}</Text>
          </View>
          {typeof input.bodyweight === "number" ? (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{labels.bodyweight}</Text>
              <Text style={styles.infoValue}>{input.bodyweight} kg</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.table}>
          <View style={styles.tableRow}>
            <Text style={styles.th}>{labels.item}</Text>
            <Text style={styles.th}>{labels.recordKg}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.td}>{labels.squat}</Text>
            <Text style={styles.td}>{input.squat}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.td}>{labels.bench}</Text>
            <Text style={styles.td}>{input.bench}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.td}>{labels.deadlift}</Text>
            <Text style={styles.td}>{input.deadlift}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.td}>{labels.total}</Text>
            <Text style={styles.td}>{input.total}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <View>
            <Text style={styles.verifyText}>{labels.verify}: {input.verificationUrl}</Text>
            <Text style={styles.verifyText}>{labels.issuer}: GymTools</Text>
            <Text style={styles.note}>{labels.note}</Text>
          </View>
          <View style={styles.qrWrap}>
            <Image style={styles.qr} src={input.qrDataUrl} />
            <Text>{labels.qr}</Text>
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

  let fallbackAscii = false;
  try {
    await registerKoreanFont(lib);
  } catch (fontError) {
    fallbackAscii = true;
    console.error("[cert-pdf] Korean font load failed. Fallback to ASCII template.", {
      message: fontError instanceof Error ? fontError.message : String(fontError),
      stack: fontError instanceof Error ? fontError.stack : undefined,
    });
  }

  try {
    const styles = createStyles(lib, fallbackAscii ? "Helvetica" : "NotoSansKR");
    const labels = createLabels(fallbackAscii);
    const doc = (
      <CertificatePdf
        lib={lib}
        styles={styles}
        labels={labels}
        input={input}
        fallbackAscii={fallbackAscii}
      />
    );
    return await lib.renderToBuffer(doc);
  } catch (renderError) {
    console.error("[cert-pdf] PDF render failed", {
      message: renderError instanceof Error ? renderError.message : String(renderError),
      stack: renderError instanceof Error ? renderError.stack : undefined,
      fallbackAscii,
    });

    if (fallbackAscii) {
      throw new Error(
        `[pdf_font_load] Font fallback mode also failed: ${renderError instanceof Error ? renderError.message : String(renderError)}`,
      );
    }

    throw renderError;
  }
}
