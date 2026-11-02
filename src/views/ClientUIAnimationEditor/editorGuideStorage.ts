import type { StorageClass } from "../../services/storage/storage";
import { CLIENT_UI_PROJECT_ID } from "./workspaceStorage";

export const EDITOR_GUIDE_STATE_PATH = "/.guide-state.json";
type GuideStorage = Pick<StorageClass, "setProject" | "exists" | "readFile" | "writeFile">;

export async function hasDismissedEditorGuide(storage: GuideStorage): Promise<boolean> {
  if (!await storage.setProject(CLIENT_UI_PROJECT_ID).exists(EDITOR_GUIDE_STATE_PATH)) return false;
  const text = await storage.setProject(CLIENT_UI_PROJECT_ID).readFile(EDITOR_GUIDE_STATE_PATH);
  try {
    const state = JSON.parse(text);
    return state?.version === 1 && state?.dismissed === true;
  } catch { return false; }
}

export async function dismissEditorGuide(storage: GuideStorage): Promise<void> {
  await storage.setProject(CLIENT_UI_PROJECT_ID).writeFile(EDITOR_GUIDE_STATE_PATH,
    JSON.stringify({ version: 1, dismissed: true }));
}
