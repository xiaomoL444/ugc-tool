import type { StorageClass } from "../../services/storage/storage";
import { ClientUIWorkspaceRepository, DEFAULT_UI_WORKSPACE, validateDocumentName, documentStoragePath } from "../ClientUIAnimationEditor/workspaceStorage";
import { parseProject } from "./particleModel";

export const PARTICLE_PROJECT_ID = "UIVfxEditor";
export const LEGACY_PARTICLE_KEY = "ugc-tools.ui-particles.v1";
const MIGRATION_PATH = "/.legacy-migration.json";
type MigrationStorage = Pick<StorageClass, "setProject" | "exists" | "readFile" | "writeFile">;
interface PendingMigration { state: "pending"; document: string; serialized: string }

export function particleDocumentName(name: string): string {
  let result = name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_").trim().slice(0, 80).replace(/\.+$/, "").trim() || "旧版粒子工程";
  try { return validateDocumentName(result); }
  catch { result = "特效_" + result; return validateDocumentName(result); }
}

/** Keep the legacy source untouched. A journal makes a failed migration retryable,
 * including failure after the target file was written but before selection saved. */
export async function migrateParticleLegacy(
  storage: MigrationStorage, repository: ClientUIWorkspaceRepository, legacy: string | null,
): Promise<boolean> {
  let pending: PendingMigration | null = null;
  if (await storage.setProject(PARTICLE_PROJECT_ID).exists(MIGRATION_PATH)) {
    const marker = JSON.parse(await storage.setProject(PARTICLE_PROJECT_ID).readFile(MIGRATION_PATH));
    if (marker.state === "complete") return false;
    if (marker.state !== "pending" || typeof marker.document !== "string" || typeof marker.serialized !== "string") throw new Error("旧版工程迁移记录损坏，原始工程仍保留在浏览器内");
    pending = { state: "pending", document: validateDocumentName(marker.document), serialized: JSON.stringify(parseProject(JSON.parse(marker.serialized))) };
  }
  if (!pending) {
    if (!legacy) {
      await storage.setProject(PARTICLE_PROJECT_ID).writeFile(MIGRATION_PATH, JSON.stringify({ state: "complete", imported: false }));
      return false;
    }
    const project = parseProject(JSON.parse(legacy));
    const workspaces = await repository.listWorkspaces();
    if (!workspaces.includes(DEFAULT_UI_WORKSPACE)) await repository.createWorkspace(DEFAULT_UI_WORKSPACE);
    const names = await repository.listDocuments(DEFAULT_UI_WORKSPACE);
    const base = particleDocumentName(project.name);
    let document = base, suffix = 2;
    while (names.includes(document)) document = base + " (" + suffix++ + ")";
    project.name = document;
    pending = { state: "pending", document, serialized: JSON.stringify(project) };
    await storage.setProject(PARTICLE_PROJECT_ID).writeFile(MIGRATION_PATH, JSON.stringify(pending));
  }
  const target = documentStoragePath(DEFAULT_UI_WORKSPACE, pending.document);
  if (await storage.setProject(PARTICLE_PROJECT_ID).exists(target)) {
    const existing = await repository.readDocument(DEFAULT_UI_WORKSPACE, pending.document);
    if (JSON.stringify(parseProject(JSON.parse(existing))) !== pending.serialized) throw new Error("旧版工程迁移目标已被修改，未覆盖已有文件；原始工程仍保留");
  } else {
    const document = await repository.createDocument(DEFAULT_UI_WORKSPACE, pending.document, pending.serialized);
    pending.document = document;
    await storage.setProject(PARTICLE_PROJECT_ID).writeFile(MIGRATION_PATH, JSON.stringify(pending));
  }
  await repository.writeSelection({ workspace: DEFAULT_UI_WORKSPACE, document: pending.document });
  await storage.setProject(PARTICLE_PROJECT_ID).writeFile(MIGRATION_PATH, JSON.stringify({ state: "complete", imported: true, document: pending.document }));
  return true;
}

