import { T } from "vue-router/dist/router-CWoNjPRp.mjs";
import { Clip } from "./clip";

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  clips: Clip<any>[];
}

export type TrackType = "Camera" | "Default";
