import type { InjectionKey, Ref } from "vue";

export type StudioEditorKind = "Dialogue" | "Quest" | "WalkTalk" | "EntityPresets" | "Scene" | "Camera";

// Editors keep ownership of their navigation state while rendering it in the shared shell.
export const studioSidebarKey: InjectionKey<Ref<HTMLElement | undefined>> = Symbol("studioSidebar");
