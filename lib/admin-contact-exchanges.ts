export const ADMIN_CONTACT_EXCHANGE_PAGE_SIZE = 10;
export const ADMIN_CONTACT_EXCHANGE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AdminContactExchangeCursor = { created_at: string; id: string };
export type AdminContactExchangeItem = {
  id: string;
  own_name: string | null;
  counterpart_name: string | null;
  counterpart_nickname: string | null;
  approved_at: string | null;
  created_at: string;
};
export type AdminContactExchangeList = {
  ok: true;
  items: AdminContactExchangeItem[];
  next_cursor: AdminContactExchangeCursor | null;
};
