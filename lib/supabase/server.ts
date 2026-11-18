import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { filterMalformedSessionCookies } from "@/lib/supabase/session-cookies";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return filterMalformedSessionCookies(cookieStore.getAll(), process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // ignore when called in environments where response cookies cannot be set
          }
        },
      },
    },
  );
}

export function createAdminClient(requestOptions?: { signal: AbortSignal }) {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    {
      ...(requestOptions ? { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {
        ...init, signal: AbortSignal.any([requestOptions.signal, AbortSignal.timeout(8000), ...(init?.signal ? [init.signal] : [])]),
      }) } } : {}),
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
