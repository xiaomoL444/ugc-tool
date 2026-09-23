/** Remove only retired Tween tracks from a freshly parsed project, never static node scales. */
export function removeRetiredScaleTweenTracks(project: Record<string, unknown>): number {
  let removed = 0;
  const clean = (owner: Record<string, unknown>, key: string) => {
    const tracks = owner[key];
    if (!Array.isArray(tracks)) return; // Leave malformed data to the existing strict validator.
    owner[key] = tracks.filter(track => {
      if (track?.fieldKey !== "localScaleX" && track?.fieldKey !== "localScaleY") return true;
      removed++;
      return false;
    });
  };
  clean(project, "tweenTracks");
  clean(project, "keyframeTracks");
  if (Array.isArray(project.animations)) {
    for (const animation of project.animations) {
      if (animation && typeof animation === "object" && !Array.isArray(animation)) clean(animation, "keyframeTracks");
    }
  }
  return removed;
}
