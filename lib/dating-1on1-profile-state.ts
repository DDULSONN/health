// Presentation only. Never infer permission to restore/edit from these labels.
export type OneOnOneProfileStateInput = { status?: string | null; archived?: boolean };

export function oneOnOneProfileState(input: OneOnOneProfileStateInput) {
  if (input.status === "rejected") {
    return input.archived === true
      ? { kind: "archived" as const, label: "내가 내린 프로필", title: "내가 내린 프로필이에요", body: "새 후보에게는 표시되지 않아요. 다시 올리기는 마이페이지에서 진행할 수 있어요." }
      : { kind: "held" as const, label: "공개 보류", title: "프로필 공개가 보류돼 있어요", body: "마이페이지에서 프로필 상태를 확인해 주세요. 공개 보류 사유나 수정 방법은 고객센터로 문의해 주세요." };
  }
  return { kind: "active" as const, label: input.status === "reviewing" ? "검토 중" : input.status === "approved" ? "승인 완료" : input.status === "submitted" ? "접수 완료" : "상태 확인 중", title: "", body: "" };
}

export const ONE_ON_ONE_PROFILE_MANAGE_HREF = "/mypage?section=matching&match=one_on_one#one-on-one-status";
