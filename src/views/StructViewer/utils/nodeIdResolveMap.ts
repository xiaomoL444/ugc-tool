let nodIdResolveMap: Record<string, string> = {};
export function ResolveNodeId(oldId: string): string {
  return nodIdResolveMap[oldId] ?? "";
}
export function BindNodeId(oldId: string, newId: string): void {
  nodIdResolveMap[oldId] = newId;
}
