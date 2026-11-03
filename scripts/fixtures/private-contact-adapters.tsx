import type { ReactNode } from "react";
export { useRouter, useSearchParams, createClient } from "./profile-ux-adapters";
export default function Link({href,children,className}:{href:string;children:ReactNode;className?:string}){
  const url=new URL(href,location.origin);url.searchParams.set('role',new URLSearchParams(location.search).get('role')||'payer');
  return <a href={url.pathname+url.search} className={className}>{children}</a>;
}
