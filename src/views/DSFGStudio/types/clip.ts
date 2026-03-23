export interface Clip<T> {
  id: string;
  name: string;
  start: number;
  duration: number;
  value: T;
}

export interface CameraClipValue {
  pointA: number;
  pointB: number;
  distance: number;
  isFollowRot: boolean;
}
