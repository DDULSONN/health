import type { SupabaseClient } from "@supabase/supabase-js";
import { parseDatingBirthYear } from "@/lib/dating-age";

type Pair = {
  source_card_id: string;
  candidate_card_id: string;
  source_user_id: string;
  candidate_user_id: string;
};

// Read only the two cards' age/ownership fields. No phone, image, or profile data.
// Missing cards/years fail closed; database errors must remain retryable errors.
export async function isOneOnOnePairAgeEligible(admin: SupabaseClient, pair: Pair): Promise<boolean> {
  if (!pair.source_card_id || !pair.candidate_card_id || pair.source_card_id === pair.candidate_card_id) return false;
  const { data, error } = await admin.from("dating_1on1_cards")
    .select("id,user_id,birth_year").in("id", [pair.source_card_id, pair.candidate_card_id]);
  if (error) throw error;
  const cards = new Map((data ?? []).map(row => [row.id, row]));
  return [[pair.source_card_id, pair.source_user_id], [pair.candidate_card_id, pair.candidate_user_id]]
    .every(([id, owner]) => {
      const card = cards.get(id);
      return card?.user_id === owner && parseDatingBirthYear(card?.birth_year) != null;
    });
}
