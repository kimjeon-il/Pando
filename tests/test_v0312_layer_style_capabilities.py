import re
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MAP_SETTINGS = (ROOT / 'assets' / 'js' / 'modules' / 'app-map-settings.js').read_text(encoding='utf-8')
RENDERING_DOMAIN = (ROOT / 'assets' / 'js' / 'modules' / 'rendering-domain.js').read_text(encoding='utf-8')
HTML = (ROOT / 'index.html').read_text(encoding='utf-8')


class LayerStyleCapabilityTests(unittest.TestCase):
    def test_layer_controls_only_expose_supported_capabilities(self):
        targets = MAP_SETTINGS[MAP_SETTINGS.index('(LAYER_STYLE_TARGETS = Object.freeze({'):MAP_SETTINGS.index('(projectSerializer =')]
        rows = dict(re.findall(r"(\w+): \{([^}]*)\}", targets))
        self.assertEqual(set(rows), {'countries','subunits','regions','distributions','rivers','lakes','genericFeatures'})
        for group in ('countries','subunits','regions'):
            for capability in ('color','opacity','boundary'):
                self.assertIn(f'{capability}: true', rows[group])
        self.assertIn('blendMode: true', rows['distributions'])
        self.assertNotIn('boundary: true', rows['distributions'])
        for group in ('rivers','lakes','genericFeatures'):
            self.assertIn('opacity: true', rows[group])
            self.assertNotIn('boundary: true', rows[group])
            self.assertNotIn('blendMode: true', rows[group])

    def test_distribution_controls_live_in_view_not_layer_tree(self):
        self.assertIn('id="distributionViewSettingsTitle">분포', HTML)
        self.assertIn('id="distributionLayerModeInput"', HTML)
        self.assertIn('id="distributionBoundaryVisibleInput"', HTML)
        self.assertNotIn('data-map-display-disclosure="distribution"', HTML)
        self.assertNotIn('data-layer-style-panel="distribution"', HTML)
        self.assertIn('const boundaryVisible = state.distributionSettings?.boundaryVisible !== false;', RENDERING_DOMAIN)


if __name__ == '__main__':
    unittest.main()
