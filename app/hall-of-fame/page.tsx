import { redirect } from "next/navigation";

export default function HallOfFamePage() {
  redirect("/community?tab=photo_bodycheck");
}
