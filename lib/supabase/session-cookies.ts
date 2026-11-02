type SessionCookie = { name: string; value: string };

// The auth SDK can log an entire malformed JSON string while recovering a
// session. Reject only malformed containers before SDK access. This does NOT
// authenticate a cookie; getUser still verifies every session with Auth.
export function filterMalformedSessionCookies<T extends SessionCookie>(cookies: T[], supabaseUrl: string): T[] {
  let key: string;
  try { key = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`; }
  catch { return cookies; }
  const whole = cookies.find(cookie => cookie.name === key)?.value;
  let value = whole ?? "";
  if (!whole) {
    for (let i = 0; i < cookies.length; i++) {
      const chunk = cookies.find(cookie => cookie.name === `${key}.${i}`)?.value;
      if (!chunk) break;
      value += chunk;
    }
  }
  if (!value) return cookies;
  try {
    if (value.startsWith("base64-")) {
      const encoded = value.slice(7).replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(encoded);
      value = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
    }
    const session: unknown = JSON.parse(value);
    if (session && typeof session === "object" && !Array.isArray(session)) return cookies;
  } catch { /* Never log cookie values or parse errors containing them. */ }
  return cookies.filter(cookie => cookie.name !== key && !(
    cookie.name.startsWith(`${key}.`) && /^\d+$/.test(cookie.name.slice(key.length + 1))
  ));
}
