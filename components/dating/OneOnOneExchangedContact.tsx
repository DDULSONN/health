import Link from "next/link";
import type { ExchangedContact } from "@/lib/dating-private-contact";

export default function OneOnOneExchangedContact({ contact }: { contact: ExchangedContact }) {
  return <div className="mt-2 text-sm">
    {contact.counterparty_instagram ? <>
      <p className="text-xs text-neutral-500">상대가 공개한 인스타그램</p>
      <a className="mt-1 inline-block break-all font-semibold text-emerald-700 underline underline-offset-4"
        href={`https://www.instagram.com/${encodeURIComponent(contact.counterparty_instagram)}/`} target="_blank" rel="noopener noreferrer">@{contact.counterparty_instagram}</a>
      <p className="mt-1 text-xs leading-5 text-neutral-500">상대가 번호 대신 인스타를 공개했어요. 짐툴에서도 대화할 수 있어요.</p>
    </> : <p className="font-semibold text-emerald-700">{contact.counterparty_phone ?? "번호 정보를 불러오는 중입니다."}</p>}
    {contact.my_contact_method === "instagram" ? <p className="mt-1 text-xs leading-5 text-neutral-500">사이트에서는 내 인스타만 공개돼요. 직접 전화·문자를 보내면 발신번호가 보일 수 있어요.</p> : null}
    {contact.contact_chat_url ? <Link href={contact.contact_chat_url} className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-neutral-200 bg-white px-4 text-xs font-semibold text-neutral-900">짐툴에서 대화하기 <span aria-hidden="true" className="ml-3">›</span></Link> : null}
  </div>;
}
