import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import LandingPage, { dynamic, metadata } from "./landing/page";

export { dynamic, metadata };

export default async function HomePage() {
  const cookieStore = await cookies();
  if (cookieStore.get("jimtool_landing_seen")?.value === "1") {
    redirect("/community/dating/cards");
  }

  return <LandingPage />;
}
