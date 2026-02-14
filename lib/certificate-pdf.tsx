import React from "react";
import {
  Document,
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

const styles = StyleSheet.create({
  page: {
    padding: 40,
    backgroundColor: "#ffffff",
    fontSize: 11,
    color: "#111827",
  },
  title: {
    fontSize: 22,
    textAlign: "center",
    marginBottom: 20,
    fontWeight: 700,
  },
  subtitle: {
    textAlign: "center",
    marginBottom: 18,
    color: "#374151",
  },
  section: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    padding: 12,
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  label: {
    color: "#374151",
  },
  value: {
    fontWeight: 700,
  },
  grid: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    marginTop: 8,
  },
  gridRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  gridCellHead: {
    flex: 1,
    padding: 6,
    backgroundColor: "#f3f4f6",
    fontWeight: 700,
  },
  gridCell: {
    flex: 1,
    padding: 6,
  },
  footer: {
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  qrBox: {
    alignItems: "center",
  },
  qrImage: {
    width: 110,
    height: 110,
    marginBottom: 4,
  },
  issuedBy: {
    marginTop: 6,
    color: "#111827",
    fontWeight: 700,
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
        <Text style={styles.subtitle}>GymTools Official Certificate</Text>

        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>인증번호</Text>
            <Text style={styles.value}>{input.certificateNo}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>발급일</Text>
            <Text style={styles.value}>{input.issuedAt}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>닉네임</Text>
            <Text style={styles.value}>{input.nickname}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>성별</Text>
            <Text style={styles.value}>{sexKo(input.sexLabel)}</Text>
          </View>
          {typeof input.bodyweight === "number" ? (
            <View style={styles.row}>
              <Text style={styles.label}>체중</Text>
              <Text style={styles.value}>{input.bodyweight} kg</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.grid}>
          <View style={styles.gridRow}>
            <Text style={styles.gridCellHead}>항목</Text>
            <Text style={styles.gridCellHead}>기록 (kg)</Text>
          </View>
          <View style={styles.gridRow}>
            <Text style={styles.gridCell}>스쿼트</Text>
            <Text style={styles.gridCell}>{input.squat}</Text>
          </View>
          <View style={styles.gridRow}>
            <Text style={styles.gridCell}>벤치프레스</Text>
            <Text style={styles.gridCell}>{input.bench}</Text>
          </View>
          <View style={styles.gridRow}>
            <Text style={styles.gridCell}>데드리프트</Text>
            <Text style={styles.gridCell}>{input.deadlift}</Text>
          </View>
          <View style={styles.gridRow}>
            <Text style={styles.gridCell}>총합</Text>
            <Text style={styles.gridCell}>{input.total}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <View>
            <Text style={styles.issuedBy}>발급기관: GymTools</Text>
            <Text>{input.verificationUrl}</Text>
          </View>
          <View style={styles.qrBox}>
            <Image style={styles.qrImage} src={input.qrDataUrl} />
            <Text>QR 검증</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderCertificatePdfBuffer(input: PdfInput): Promise<Buffer> {
  const document = <CertificatePdf {...input} />;
  return renderToBuffer(document);
}

