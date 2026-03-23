import { Track } from "./track"

export interface Timeline {
  duration: number
  pxPerSecond: number
  tracks: Track[]
}