export function assertOwnedGroupSelection(requested: string[], owned: { group_jid: string }[]) {
  const ownedIds = new Set(owned.map((group) => group.group_jid));
  if (requested.some((groupId) => !ownedIds.has(groupId))) throw new Error("Um ou mais grupos não são acessíveis pelo número selecionado.");
}
