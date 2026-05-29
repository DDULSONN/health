import { redirect } from "next/navigation";
import { getServerUserAndAdminStatus } from "@/lib/admin";
import FlirtingGeneratorClient from "./FlirtingGeneratorClient";

export default async function AdminFlirtingGeneratorPage() {
  const { user, isAdmin } = await getServerUserAndAdminStatus();

  if (!user) {
    redirect("/login?redirect=/admin/flirting-generator");
  }

  if (!isAdmin) {
    redirect("/");
  }

  return <FlirtingGeneratorClient />;
}
