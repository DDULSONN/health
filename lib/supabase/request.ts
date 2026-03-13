import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

type RequestAuthContext = {
  client: SupabaseClient;
  user: User | null;
  authMode: "cookie" | "bearer" | "anonymous";
};

function readBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token ? token : null;
}

export async function getRequestAuthContext(req: Request): Promise<RequestAuthContext> {
  const cookieClient = await createServerClient();
  const cookieUserRes = await cookieClient.auth.getUser();
  if (cookieUserRes.data.user) {
    return {
      client: cookieClient,
      user: cookieUserRes.data.user,
      authMode: "cookie",
    };
  }

  const token = readBearerToken(req);
  if (!token) {
    return {
      client: cookieClient,
      user: null,
      authMode: "anonymous",
    };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const bearerClient = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const bearerUserRes = await bearerClient.auth.getUser(token);
  return {
    client: bearerClient,
    user: bearerUserRes.data.user ?? null,
    authMode: bearerUserRes.data.user ? "bearer" : "anonymous",
  };
}
