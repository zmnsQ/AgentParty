/** Account labels are display-only; identity, routing and authorization keep name. */
export function preferredMeDisplay(me: {
  name: string;
  kind: string;
  preferred_display?: string | null;
  display_name?: string | null;
  handle?: string | null;
}): string {
  const preferred = me.preferred_display?.trim();
  if (preferred) return preferred;
  // Older /me responses may populate both fields from an agent's owner profile.
  // Without the server's resolved label, neither can prove an agent nickname.
  if (me.kind === "agent") return me.name;
  // Preserve old-server human behavior: no client-side guess that a handle is
  // user-selected rather than a generated provider default.
  return me.display_name?.trim() || me.handle?.trim() || me.name;
}
