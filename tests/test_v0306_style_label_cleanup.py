from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
COLOR = (ROOT / "assets" / "js" / "modules" / "color-adapter.js").read_text(encoding="utf-8")
PRESENTATION = (ROOT / "assets" / "js" / "modules" / "layer-presentation.js").read_text(encoding="utf-8")


class StyleLabelCleanupTests(unittest.TestCase):
    def test_raw_label_and_layer_tuning_controls_are_absent(self):
        for element_id in (
            "labelPriorityInput", "labelCollisionInput", "labelMinZoomInput", "labelMaxZoomInput",
            "layerStyleBoundaryWidthInput", "layerStyleRenderOrderInput", "layerPresentationList",
        ):
            self.assertNotIn(f'id="{element_id}"', INDEX)
        self.assertIn('id="layerStyleOpacityInput"', INDEX)
        self.assertIn('id="layerStyleLabelsVisibleInput"', INDEX)
        self.assertIn("boundaryWidth: DEFAULT_STYLE.boundaryWidth", PRESENTATION)
        self.assertIn("const overlayOrder = [...OVERLAY_GROUPS]", PRESENTATION)

    def test_country_labels_use_projected_screen_metrics_and_collision_layout(self):
        block = APP[APP.index("function countryLabelScreenMetrics"):APP.index("function renderPendingCountryOverlays")]
        self.assertIn("path.bounds(feature)", block)
        self.assertIn("metrics.textWidth", block)
        self.assertIn("metrics.area", block)
        self.assertNotIn("pop_est", block)
        layout = APP[APP.index("function visibleLabelLayout"):APP.index("function renderCountryLabels")]
        self.assertIn("countryLabelScreenMetrics(displayFeature", layout)
        self.assertIn("layoutLabels(candidates", layout)
        self.assertIn("selected,", layout)

    def test_editable_domains_use_the_common_color_adapter(self):
        for domain in ("COUNTRY", "TERRITORIAL", "DRAWING", "DISTRIBUTION"):
            self.assertIn(f"COLOR_DOMAINS.{domain}", APP)
        for symbol in ("readDomainColor", "writeDomainColor", "normalizeColorValue"):
            self.assertIn(f"function {symbol}", COLOR)
            self.assertIn(symbol, APP)


if __name__ == "__main__":
    unittest.main()
