from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")


class EditorChromeTests(unittest.TestCase):
    def test_selected_object_type_badges_are_completely_removed(self):
        combined = INDEX + APP + CSS
        for obsolete in ('propertyType', 'type-chip', 'offline-chip'):
            self.assertNotIn(obsolete, combined)

    def test_every_static_and_dynamic_button_uses_the_common_primitive(self):
        buttons = re.findall(r'<button\b([^>]*)>', INDEX)
        self.assertGreater(len(buttons), 30)
        for attributes in buttons:
            class_match = re.search(r'class="([^"]*)"', attributes)
            self.assertIsNotNone(class_match, attributes)
            self.assertIn('ui-button', class_match.group(1).split(), attributes)
        self.assertIn("name.className = 'ui-button layer-child-name';", APP)

    def test_active_component_families_use_shared_composition_primitives(self):
        for component in (
            'ui-card', 'ui-row', 'ui-row-button', 'ui-card-button',
            'ui-choice-row', 'ui-field', 'ui-disclosure', 'ui-info-list',
            'ui-segmented', 'ui-segment-option',
        ):
            self.assertIn(component, INDEX + APP)

    def test_unused_legacy_components_are_removed(self):
        combined = INDEX + APP + CSS
        for obsolete in (
            'tool-card', 'primary-tool-grid', 'utility-grid', 'status-box',
            'status-row', 'countryStatus', 'autosaveStatus', 'text-btn',
        ):
            self.assertNotIn(obsolete, combined)

    def test_close_control_keeps_side_spacing_and_adds_top_spacing(self):
        self.assertIn('#app .right-panel .mobile-sheet-header {', CSS)
        editor_header_rules = CSS[CSS.rindex('#app .right-panel .mobile-sheet-header {'):]
        self.assertIn('min-height: 68px;', editor_header_rules[:180])
        self.assertIn('padding-top: 18px;', editor_header_rules[:180])
        self.assertIn('#app .right-panel .mobile-sheet-header .sheet-close-btn {', CSS)
        close_rules = CSS[CSS.rindex('#app .right-panel .mobile-sheet-header .sheet-close-btn {'):]
        self.assertIn('top: 18px;', close_rules[:160])
        self.assertIn('right: var(--ui-space-2);', close_rules[:160])
        self.assertNotIn('right: calc(-1 * var(--ui-space-3));', CSS)

    def test_hydro_metadata_does_not_draw_nested_table_borders(self):
        self.assertIn('#hydroProperties .meta-card {', CSS)
        self.assertIn('#hydroProperties .meta-card div {', CSS)
        hydro_rules = CSS[CSS.rindex('#hydroProperties .meta-card {'):]
        self.assertIn('border: 0;', hydro_rules[:400])


if __name__ == "__main__":
    unittest.main()
