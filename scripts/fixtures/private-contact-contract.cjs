/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict');
const reviewed=require('./private-contact-reviewed-additions.json');
function withoutPrivateAdditions(source,file){
  source=source.replace(/\r\n/g,'\n');
  for(const {before,after} of reviewed[file]){
    assert.equal(source.split(after).length,2,'Exact reviewed private-contact addition: '+file);
    source=source.replace(after,before);
  }
  return source;
}
// Strip only the explicit opt-in additions, whose actual route/SQL behavior is
// covered by check-private-contact.cjs. Keep the historical phone-only hashes.
function withoutPrivateConfirmation(source){
  source=source.replace(/\r\n/g,'\n');
  if(!source.includes('import { fulfillPrivateContact, preflightPrivateContact }'))return source;
  const fragments=[
    'import { fulfillPrivateContact, preflightPrivateContact } from "@/lib/dating-private-contact-server";\n',
    'import { parsePayerContact } from "@/lib/dating-private-contact";\n',
    '  if (order.product_meta?.payerContact != null) return fulfillPrivateContact(admin, order);\n',
    '      const storedContact = order.product_meta?.payerContact == null ? null : parsePayerContact(order.product_meta.payerContact);\n',
    '      if (storedContact) await preflightPrivateContact(admin, matchId ?? "", user.id, storedContact.instagram);\n',
  ];
  for(const text of fragments){assert.equal(source.split(text).length,2,'reviewed opt-in confirmation addition');source=source.replace(text,'');}
  return source;
}
function withoutPrivateView(source){
  source=source.replace(/\r\n/g,'\n');
  if(!source.includes('import type { PayerContactChoice } from "@/lib/dating-private-contact";'))return source;
  source=source.replace('import type { PayerContactChoice } from "@/lib/dating-private-contact";\n','')
    .replace('import OneOnOneExchangedContact from "@/components/dating/OneOnOneExchangedContact";\n','')
    .replace('  counterparty_instagram?: string | null;\n  contact_chat_url?: string | null;\n  my_contact_method?: "phone" | "instagram";\n','')
    .replaceAll(', payerContact?: PayerContactChoice','')
    .replace(/^ +\.\.\.\(payerContact \? \{ payerContact \} : \{\}\),\n/gm,'')
    .replaceAll('(id, offerId, choice) => void handleRequestOneOnOneContactExchange(id, offerId, choice)','(id, offerId) => void handleRequestOneOnOneContactExchange(id, offerId)')
    .replace('                                    <OneOnOneExchangedContact contact={match} />',`                                    <p className="mt-1 text-sm font-semibold text-emerald-700">
                                      {match.counterparty_phone ?? "번호 정보를 불러오는 중입니다."}
                                    </p>`)
    .replace('{focusedMatch.contact_exchange_status === "approved" ? <OneOnOneExchangedContact contact={focusedMatch} /> : null}','{focusedMatch.counterparty_phone ? <p className="mt-2 text-sm font-black text-emerald-700">{focusedMatch.counterparty_phone}</p> : null}')
    .replace('{match.contact_exchange_status === "approved" ? <OneOnOneExchangedContact contact={match} /> : null}','{match.counterparty_phone ? <p className="mt-2 text-sm font-black text-emerald-700">{match.counterparty_phone}</p> : null}');
  return source;
}
module.exports={withoutPrivateConfirmation,withoutPrivateView,withoutPrivateAdditions};
