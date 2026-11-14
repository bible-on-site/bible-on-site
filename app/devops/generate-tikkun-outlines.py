"""Export the bundled font's base and mark contours without changing glyph geometry.

Run with Python and fonttools installed after changing TaameyD-Regular.ttf.
HarfBuzz still shapes complete marked words at runtime. These contours only let
the canvas paint their base and annotation layers separately, including marks
inside composite glyphs such as yoddagesh and trueshin.
"""

import hashlib
import json
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont


class LayerPen(BasePen):
    """Decompose components while retaining either base or mark outlines."""

    def __init__(self, glyph_set, classes, composites, marks):
        super().__init__(glyph_set)
        self.classes = classes
        self.composites = composites
        self.marks = marks
        self.commands = []
        self.contour_ends = []

    def _moveTo(self, point):
        self.commands.extend([0, *point])

    def _lineTo(self, point):
        self.commands.extend([1, *point])

    def _qCurveToOne(self, control, end):
        self.commands.extend([2, *control, *end])

    def _curveToOne(self, first, second, end):
        self.commands.extend([3, *first, *second, *end])

    def _closePath(self):
        self.commands.append(4)
        self.contour_ends.append(len(self.commands))

    def addComponent(self, glyphName, transformation):
        # An entire mark glyph belongs to the annotation layer. Other
        # composites may contain both kinds; recurse into their components.
        if self.classes.get(glyphName) == 3:
            if self.marks:
                BasePen.addComponent(self, glyphName, transformation)
        elif glyphName in self.composites:
            BasePen.addComponent(self, glyphName, transformation)
        elif not self.marks:
            BasePen.addComponent(self, glyphName, transformation)


def main():
    """Write deterministic contour data paired to the exact packaged font."""
    fonts = Path(__file__).resolve().parents[1] / "BibleOnSite/Resources/Fonts"
    font_path = fonts / "TaameyD-Regular.ttf"
    font = TTFont(font_path)
    glyph_set = font.getGlyphSet()
    classes = font["GDEF"].table.GlyphClassDef.classDefs
    composites = {name for name in font.getGlyphOrder() if font["glyf"][name].isComposite()}
    glyphs = []
    for name in font.getGlyphOrder():
        # Taamey D's U+FB1F is the one pointed presentation form drawn as a
        # simple glyph. Its final rectangle is the patach below the two yods.
        # Assert the contour contract so a future font update needs review.
        if name == "yodyodpatax":
            pen = LayerPen(glyph_set, classes, composites, False)
            glyph_set[name].draw(pen)
            cut = pen.contour_ends[-2]
            base, marks = pen.commands[:cut], pen.commands[cut:]
            assert marks == [0, 852, 287, 1, 76, 287, 1, 76, 381, 1, 852, 381, 4]
            glyphs.append({"Name": name, "Base": base, "Marks": marks})
            continue
        layers = []
        for marks in (False, True):
            pen = LayerPen(glyph_set, classes, composites, marks)
            # Simple glyphs have no components through which to filter.
            if font["glyf"][name].isComposite() or (classes.get(name) == 3) == marks:
                glyph_set[name].draw(pen)
            layers.append(pen.commands)
        glyphs.append({"Name": name, "Base": layers[0], "Marks": layers[1]})

    result = {
        "FontSha256": hashlib.sha256(font_path.read_bytes()).hexdigest(),
        "UnitsPerEm": font["head"].unitsPerEm,
        "Ascent": font["hhea"].ascent,
        "Descent": font["hhea"].descent,
        "Glyphs": glyphs,
    }
    output = fonts / "TaameyD-outlines.json"
    output.write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    print(f"Exported {len(glyphs)} glyphs to {output.name} ({output.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
