const DATING_CARD_BLUR_FILE = /^[\w.-]+\.(?:avif|jpe?g|png|webp)$/i;

// Only the server-generated blur namespace is a safe substitute for a
// non-public original. A lite/thumb derivative does not make a photo private.
export function isDatingCardBlurPath(objectPath: string, ownerId: string): boolean {
  const parts = objectPath.split("/");
  return Boolean(ownerId)
    && parts.length === 4
    && parts[0] === "cards"
    && parts[1] === ownerId
    && parts[2] === "blur"
    && DATING_CARD_BLUR_FILE.test(parts[3]);
}
