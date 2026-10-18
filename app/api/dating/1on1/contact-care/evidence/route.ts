import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { careJson, careError } from "@/lib/contact-care-server";
import { CONTACT_CARE_UUID } from "@/lib/contact-care";

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) return careJson({ error: "로그인이 필요해요." }, 401);
  const query = new URL(req.url).searchParams;
  const id = query.get("claimId") ?? "", index = query.get("index") ?? "";
  if (!CONTACT_CARE_UUID.test(id) || !/^[0-2]$/.test(index)) return careJson({ error: "첨부 정보를 확인해 주세요." }, 400);
  const admin = createAdminClient();
  try {
    const claim = await admin.from("contact_care_claims").select("user_id,upload_id,status,reviewed_at").eq("id", id).maybeSingle();
    if (claim.error) throw claim.error;
    if (!claim.data) return careJson({ error: "첨부를 찾을 수 없어요." }, 404);
    if (claim.data.user_id !== user.id) {
      const auth = await requireAdminRoute();
      if (!auth.ok) return careJson({ error: "첨부를 확인할 수 없어요." }, 403);
    }
    if (["approved", "rejected"].includes(claim.data.status) && Date.parse(claim.data.reviewed_at) < Date.now() - 30 * 86400000) return careJson({ error: "캡처 열람 기간이 지났어요." }, 410);
    const upload = await admin.from("contact_care_uploads").select("paths,purging").eq("id", claim.data.upload_id).maybeSingle();
    if (upload.error) throw upload.error;
    const path = upload.data?.paths?.[Number(index)];
    if (!path || upload.data?.purging) return careJson({ error: "첨부를 찾을 수 없어요." }, 404);
    const file = await admin.storage.from("contact-care-evidence").download(path);
    if (file.error || !file.data) return careJson({ error: "첨부를 불러오지 못했어요. 다시 확인해 주세요." }, 404);
    return new Response(file.data, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline; filename=conversation.webp", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch (error) { return careError(error); }
}
