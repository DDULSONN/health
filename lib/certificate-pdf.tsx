import path from "path";
import { pathToFileURL } from "url";
import React from "react";
import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

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

let fontRegistered = false;

function registerKoreanFont() {
  if (fontRegistered) return;
  const regularPath = pathToFileURL(path.join(process.cwd(), "public", "fonts", "NotoSansKR-Regular.ttf")).toString();
  const boldPath = pathToFileURL(path.join(process.cwd(), "public", "fonts", "NotoSansKR-Bold.ttf")).toString();

  Font.register({
    family: "NotoSansKR",
    fonts: [
      { src: regularPath, fontWeight: 400 },
      { src: boldPath, fontWeight: 700 },
    ],
  });
  fontRegistered = true;
}

const styles = StyleSheet.create({
  page: {
    padding: 36,
    backgroundColor: "#ffffff",
    fontSize: 11,
    color: "#111827",
    fontFamily: "NotoSansKR",
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

function sexKo(value: string) {
  return value === "male" ? "남성" : "여성";
}

function CertificatePdf(input: PdfInput) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>3대 합계 공식 인증서</Text>

        <View style={styles.topRow}>
          <Text style={styles.topMeta}>GymTools Official Certificate</Text>
          <Text style={styles.topMeta}>
            인증번호: {input.certificateNo}
            {"\n"}
            발급일: {input.issuedAt}
          </Text>
        </View>

        <View style={styles.infoBox}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>닉네임</Text>
            <Text style={styles.infoValue}>{input.nickname}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>성별</Text>
            <Text style={styles.infoValue}>{sexKo(input.sexLabel)}</Text>
          </View>
          {typeof input.bodyweight === "number" ? (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>체중</Text>
              <Text style={styles.infoValue}>{input.bodyweight} kg</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.table}>
          <View style={styles.tableRow}>
            <Text style={styles.th}>항목</Text>
            <Text style={styles.th}>기록(kg)</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.td}>스쿼트</Text>
            <Text style={styles.td}>{input.squat}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.td}>벤치프레스</Text>
            <Text style={styles.td}>{input.bench}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.td}>데드리프트</Text>
            <Text style={styles.td}>{input.deadlift}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.td}>합계</Text>
            <Text style={styles.td}>{input.total}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <View>
            <Text style={styles.verifyText}>검증: {input.verificationUrl}</Text>
            <Text style={styles.verifyText}>발급기관: GymTools</Text>
            <Text style={styles.note}>본 인증서는 제출된 영상 자료를 운영자가 확인 후 발급되었습니다.</Text>
          </View>
          <View style={styles.qrWrap}>
            <Image style={styles.qr} src={input.qrDataUrl} />
            <Text>QR 검증</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderCertificatePdfBuffer(input: PdfInput): Promise<Buffer> {
  registerKoreanFont();
  const document = <CertificatePdf {...input} />;
  return renderToBuffer(document);
}

