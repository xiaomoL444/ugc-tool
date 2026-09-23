/** Canvas gives straight RGBA; Go image.RGBA requires premultiplied channels. */
export function preparePrimitivePixels(pixels: Uint8ClampedArray, preserveTransparency: boolean) {
  const rgba = new Uint8Array(pixels.length), alpha = new Uint8Array(pixels.length / 4);
  let hasAlpha = false, visible = false;
  for (let i = 0; i < alpha.length; i++) {
    const a = pixels[i * 4 + 3]; alpha[i] = a;
    if (a < 255) hasAlpha = true;
    if (a > 0) visible = true;
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(pixels[i * 4 + c] * a / 255 + (preserveTransparency ? 0 : 255 - a));
    rgba[i * 4 + 3] = preserveTransparency ? a : 255;
  }
  return { rgba, alpha, hasAlpha, visible };
}
