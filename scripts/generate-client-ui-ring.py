"""Generate the one missing circular-ring PNG for ClientUIAnimationEditor."""

from pathlib import Path

from PIL import Image, ImageDraw


SIZE = 256
SCALE = 4
CANVAS = SIZE * SCALE
WHITE = (240, 240, 240, 255)
OUTPUT_FILE = Path(__file__).resolve().parents[1] / "src" / "assets" / "ClientUIAnimationEditor" / "UI_UGC_CustomShape_Ring.png"


image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.ellipse((3 * SCALE, 3 * SCALE, 253 * SCALE, 253 * SCALE), fill=WHITE)
draw.ellipse((27 * SCALE, 27 * SCALE, 229 * SCALE, 229 * SCALE), fill=(0, 0, 0, 0))
image.resize((SIZE, SIZE), Image.Resampling.LANCZOS).save(OUTPUT_FILE, format="PNG", optimize=True)
