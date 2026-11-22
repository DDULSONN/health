export function openCardWaitDescription(position?: number | null) {
  const rank = typeof position === "number" && Number.isInteger(position) && position > 0 ? `대기 ${position}번째예요. ` : "";
  return `${rank}순서가 되면 무료로 공개돼요.`;
}
