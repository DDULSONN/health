const PAGE_SIZE = 500;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function getMemberOnlyMirrorOwners(admin) {
  const owners = new Set();
  let cursor;
  for (;;) {
    let query = admin.from("dating_cards").select("id,owner_user_id").eq("members_only", true)
      .order("id", { ascending: true }).limit(PAGE_SIZE);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) throw Error("Cannot verify members-only OpenCards; public backfill stopped");
    if (data.length === 0) return owners;
    for (const row of data) {
      if (!UUID.test(row?.id) || !UUID.test(row?.owner_user_id) || (cursor && row.id <= cursor)) {
        throw Error("Invalid members-only OpenCard data; public backfill stopped");
      }
      owners.add(row.owner_user_id.toLowerCase());
      cursor = row.id;
    }
  }
}

export function publicMirrorOwner(value) {
  if (typeof value !== "string") return null;
  let path;
  try { path = decodeURIComponent(value.trim().split(/[?#]/, 1)[0]); }
  catch { return null; }
  if (path.includes("\\") || path.includes("..")) return null;
  const match = path.match(/^(?:[^?#]*\/)?cards\/([0-9a-f-]+)\/(?:raw|blur|thumb|lite)\/[\w.-]+$/i);
  return match && UUID.test(match[1]) ? match[1].toLowerCase() : null;
}

export function canMirrorDatingPath(value, restrictedOwners) {
  const owner = publicMirrorOwner(value);
  return owner !== null && !restrictedOwners.has(owner);
}

export async function recheckPublicMirrorPaths(admin, paths, restrictedOwners) {
  if (paths.length === 0 || paths.some(path => !canMirrorDatingPath(path, restrictedOwners))) return false;
  const owners = [...new Set(paths.map(publicMirrorOwner))];
  const { data, error } = await admin.from("dating_cards").select("owner_user_id").eq("members_only", true)
    .in("owner_user_id", owners).limit(1);
  if (error || !Array.isArray(data)) throw Error("Cannot recheck members-only OpenCards; public backfill stopped");
  for (const row of data) {
    if (!UUID.test(row?.owner_user_id) || !owners.includes(row.owner_user_id.toLowerCase())) {
      throw Error("Invalid members-only OpenCard data; public backfill stopped");
    }
    restrictedOwners.add(row.owner_user_id.toLowerCase());
  }
  return data.length === 0;
}
