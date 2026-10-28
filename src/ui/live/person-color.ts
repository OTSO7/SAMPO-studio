/** A steady colour for each person in a session, the same on every computer. */
export function personColor(peer: string): string {
  let hash = 0;
  for (const char of peer) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 70% 62%)`;
}
