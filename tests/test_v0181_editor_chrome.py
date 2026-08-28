from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets/css/app.css").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")


class EditorChromeTests(unittest.TestCase):
    def test_selected_object_type_is_plain_header_metadata(self):
        combined = INDEX + APP + CSS
        self.assertIn('id="propertyTypeLabel"', INDEX)
        for obsolete in ('type-chip', 'offline-chip'):
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
        self.assertIn('.editor-shell-header {', CSS)
        editor_header_rules = CSS[CSS.index('\n.editor-shell-header {'):]
        self.assertIn('min-height: var(--ui-sheet-header-height-compact);', editor_header_rules[:320])
        self.assertIn('padding: 0 var(--ui-panel-padding);', editor_header_rules[:320])
        self.assertIn('.editor-shell-header .sheet-close-btn {', CSS)
        self.assertNotIn('right: calc(-1 * var(--ui-space-3));', CSS)

    def test_hydro_metadata_does_not_draw_nested_table_borders(self):
        self.assertIn('class="ui-info-list editor-info-list"', INDEX)
        self.assertIn('.editor-info-list > div {', CSS)
        info_rules = CSS[CSS.rindex('.editor-info-list > div {'):]
        self.assertIn('border: 0;', info_rules[:420])
        self.assertNotIn('#hydroProperties .', CSS)


if __name__ == "__main__":
    unittest.main()
