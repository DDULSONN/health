import { redirect } from "next/navigation";

export default function BodycheckWriteRedirectPage() {
  redirect("/community/write?type=photo_bodycheck");
}
