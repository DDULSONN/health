import type { Metadata } from "next";
import AdminUnlockClient from "./AdminUnlockClient";

export const metadata: Metadata = {
  title: "관리자 2차 확인",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminUnlockPage() {
  return <AdminUnlockClient />;
}
