from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / 'assets/js/app.js').read_text(encoding='utf-8')
HTML = (ROOT / 'index.html').read_text(encoding='utf-8')


class LayerStyleCapabilityTests(unittest.TestCase):
    def test_layer_controls_only_expose_supported_capabilities(self):
        targets = APP[APP.index('const LAYER_STYLE_TARGETS'):APP.index('function updateLayerPresentationStyle')]
        self.assertIn("countries: { presentationGroup: 'countries', label: '국가', opacity: true, boundary: true, boundaryLabel: '국경 표시' }", targets)
        for group in ('territories', 'administrative', 'regions'):
            self.assertIn(f"{group}: {{ presentationGroup: '{group}'", targets)
        for group in ('languages', 'ethnicities', 'religions'):
            self.assertIn(f"{group}: {{ presentationGroup: '{group}',", targets)
            self.assertIn("blendMode: true", targets)
        self.assertIn("rivers: { presentationGroup: 'rivers', label: '강', opacity: true }", targets)
        self.assertIn("lakes: { presentationGroup: 'lakes', label: '호수', opacity: true }", targets)
        self.assertIn("genericFeatures: { presentationGroup: 'genericFeatures', label: '기타 객체', opacity: true, opacityLabel: '전체 투명도' }", targets)

    def test_distribution_controls_live_in_view_not_layer_tree(self):
        self.assertIn('id="distributionViewSettingsTitle">인문 분포', HTML)
        self.assertIn('id="distributionLayerModeInput"', HTML)
        self.assertIn('id="distributionBoundaryVisibleInput"', HTML)
        self.assertNotIn('data-layer-style-toggle="distribution"', HTML)
        self.assertNotIn('data-layer-style-panel="distribution"', HTML)
        self.assertIn('const boundaryVisible = state.distributionSettings?.boundaryVisible !== false;', APP)


if __name__ == '__main__':
    unittest.main()
