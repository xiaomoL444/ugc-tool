import { Component, defineAsyncComponent } from "vue";
import DefaultEditor from "../components/editormap/DefaultEditor.vue";
import { TrackType } from "../types/track";
import { consola } from "consola";

const editorMap: Record<TrackType, Component> = {
  Camera: defineAsyncComponent(
    () => import("../components/editormap/CameraEditor.vue"),
  ),
  Default: DefaultEditor,
};

export function getEditor(type: TrackType) {
  consola.trace(`${type}`);
  return editorMap[type] ?? DefaultEditor;
}
