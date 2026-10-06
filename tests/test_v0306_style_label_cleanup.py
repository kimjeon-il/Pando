from __future__ import annotations
from tests.application_source import function_source, read_application_sources, read_module

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = read_application_sources(ROOT)
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
        self.assertIn('data-layer-style-opacity', APP)
        self.assertIn('data-layer-style-boundary', APP)
        self.assertIn("boundaryWidth: DEFAULT_STYLE.boundaryWidth", PRESENTATION)
        self.assertIn("const overlayOrder = [...OVERLAY_GROUPS]", PRESENTATION)

    def test_country_labels_use_projected_screen_metrics_and_collision_layout(self):
        source = read_module(ROOT,'app-territorial-labels.js')
        metrics = function_source(source,'territorialLabelScreenMetrics')
        self.assertIn('projectedExtent', metrics)
        self.assertIn('textWidth', metrics)
        self.assertIn('area', metrics)
        self.assertNotIn('pop_est', metrics)
        layout = function_source(source,'visibleLabelLayout')
        self.assertIn('territorialLabelScreenMetrics(displayFeature', layout)
        self.assertIn('layoutLabels)(qualityCandidates', layout)
        self.assertIn('protectedCandidates', layout)
        self.assertIn('selected,', layout)
        self.assertIn('frameContext.safeInset', layout)

    def test_editable_domains_use_the_common_color_adapter(self):
        for domain in ("TERRITORIAL", "GENERIC", "DISTRIBUTION"):
            self.assertIn(f"COLOR_DOMAINS.{domain}", APP)
        for symbol in ("readDomainColor", "writeDomainColor", "normalizeColorValue"):
            self.assertIn(f"function {symbol}", COLOR)
            self.assertIn(symbol, APP)


if __name__ == "__main__":
    unittest.main()
