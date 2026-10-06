from __future__ import annotations
from tests.application_source import element_markup, function_source, read_application_sources, read_module, read_ui_sources

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
OBJECT_PROPERTIES = (ROOT / "assets/js/modules/object-property-controller.js").read_text(encoding="utf-8")
CSS = read_ui_sources(ROOT)
DIALOG_CSS = (ROOT / "assets/css/components/dialogs.css").read_text(encoding="utf-8")
TERRITORIAL_SERVICE = (ROOT / "assets/js/modules/territorial-service.js").read_text(encoding="utf-8")


class ObjectEditorV0303Tests(unittest.TestCase):
    def form_markup(self, element_id: str) -> str:
        match = re.search(rf'<form id="{element_id}"[\s\S]+?</form>', INDEX)
        self.assertIsNotNone(match)
        return match.group(0)

    def test_removed_surfaces_have_no_dom_or_event_hooks(self):
        combined = INDEX + APP
        for element_id in (
            "historyTabBtn",
            "historyPanel",
            "countryComponentsSection",
            "countryComponentList",
            "regionLockedInput",
            "administrativeLockedInput",
            "regionLockedInput",
            "deleteCountryBtn",
            "deleteRegionBtn",
            "propertyAreaValue",
        ):
            self.assertNotIn(element_id, combined)
        self.assertNotIn("installAdvancedActionDisclosures", APP)
        self.assertNotIn("generated-advanced-actions", combined)

    def test_header_and_tabs_are_fixed_outside_the_scroll_body(self):
        surface = element_markup(INDEX, 'editorSurface')
        context = surface.index('id="editorObjectHeader"')
        tabs = surface.index('class="ui-tabs surface-tabs editor-view-tabs hidden"')
        body = surface.index('id="editorScrollBody"')
        self.assertLess(context, tabs)
        self.assertLess(tabs, body)
        self.assertNotIn('editorObjectHeader', element_markup(INDEX, 'editorScrollBody'))
        self.assertIn('syncActionTab(type)', OBJECT_PROPERTIES)
        self.assertIn("availableViews.length <= 1", OBJECT_PROPERTIES)
        self.assertIn("'editSheetTitle editorObjectHeading'", OBJECT_PROPERTIES)

    def test_multi_selection_uses_the_editor_header_without_a_card_surface(self):
        multi = element_markup(INDEX, 'multiProperties')
        self.assertNotIn('ui-card', multi)
        self.assertIn('multiPropertiesColorTrigger', multi)
        self.assertNotIn('multiPropertiesCount', INDEX)
        self.assertNotIn('multiPropertiesTypes', INDEX)
        self.assertIn("show('multi'", read_module(ROOT,'app-domain-assembly.js'))
        self.assertIn('editorObjectHeader', OBJECT_PROPERTIES)

    def test_target_information_forms_are_flat_and_ordered(self):
        entity = self.form_markup('entityProperties')
        positions = [entity.index(f'id="{element_id}"') for element_id in ('entityNameInput','entityPeriodInput','entityNotesInput')]
        self.assertEqual(positions, sorted(positions))
        for form_id in ('entityProperties','distributionProperties','genericFeatureProperties','labelProperties'):
            markup = self.form_markup(form_id)
            self.assertIn('editor-object-form', markup)
            self.assertNotIn('class="ui-card editor-section', markup)
        label = self.form_markup('labelProperties')
        positions = [label.index(f'id="{element_id}"') for element_id in ('labelNameInput','labelKindInput','labelPositionValue','labelNotesInput')]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('editor-object-form', element_markup(INDEX,'hydroProperties'))

    def test_identification_copy_and_flat_disclosure_are_canonical(self):
        for obsolete in ('countryProperties','territoryProperties','administrativeProperties','regionProperties'):
            self.assertNotIn(f'id="{obsolete}"', INDEX)
        self.assertIn('entityPeriodInput', self.form_markup('entityProperties'))
        self.assertIn('genericFeatureIdInput', self.form_markup('genericFeatureProperties'))
        self.assertIn('hydroIdValue', element_markup(INDEX,'hydroProperties'))
        self.assertIn('.editor-object-form > .editor-disclosure', CSS)
        self.assertNotIn('.editor-object-form > .editor-disclosure', DIALOG_CSS)
        self.assertNotIn('.editor-disclosure > summary', DIALOG_CSS)

    def test_semantic_typography_roles_are_shared_by_every_object_editor(self):
        for class_name in ('editor-property-list','editor-meta-list','editor-readonly-value','editor-property-heading'):
            self.assertIn(class_name, INDEX + CSS)
        self.assertNotIn('hydroPropertiesTitle', INDEX + APP)
        self.assertIn('.editor-object-form .editor-disclosure > summary', CSS)
        self.assertIn('font-size: var(--ui-font-body)', CSS)
        self.assertIn('font-weight: var(--ui-weight-semibold)', CSS)
        self.assertNotIn('.app-root[data-layout="mobile"] .editor-object-heading > span', CSS)

    def test_flags_and_actions_use_the_compact_common_grammar(self):
        header = element_markup(INDEX, 'editorObjectHeader')
        self.assertIn('flagMenuBtn', header)
        menu = element_markup(INDEX,'flagMenu')
        self.assertIn('role="menu"', menu)
        for element_id in ('flagLibraryBtn','flagUploadBtn','flagDefaultBtn','flagRemoveBtn'):
            control = element_markup(menu,element_id)
            self.assertIn('role="menuitem"', control)
            self.assertIn('<svg', control)
        entity = self.form_markup('entityProperties')
        self.assertIn('editor-action-row', entity)
        self.assertNotIn('editor-action-grid', entity)
        self.assertIn('min-height: var(--ui-touch-height)', CSS)

    def test_context_menu_and_safe_fit_match_the_surface_contract(self):
        menu = element_markup(INDEX,'objectActionsMenu')
        self.assertIn('role="menu"', menu)
        self.assertIn('id="objectFocusMenuBtn"', menu)
        fit = read_module(ROOT,'app-camera-navigation.js')
        self.assertIn('function currentObjectFitInsets()', APP)
        self.assertIn('const viewportCenter = [width / 2, height / 2]', fit)
        self.assertIn('alignGeographicAnchor(anchor, viewportCenter)', fit)
        self.assertNotIn('panMapBy(offsetX, offsetY)', fit)
        self.assertIn('--map-safe-right: var(--projection-safe-right)', CSS)
        self.assertIn('projection-safe-left', CSS)

    def test_entity_relations_and_three_mobile_snaps_are_present(self):
        entity = self.form_markup('entityProperties')
        self.assertIn('entityRelations', entity)
        self.assertIn('entityParentRows', entity)
        self.assertIn('entityChildRows', entity)
        workspace = read_module(ROOT,'app-workspace-surfaces.js')
        for token in ('MOBILE_SHEET_SNAP_COLLAPSED_PX','MOBILE_SHEET_EDITOR_RATIOS','MOBILE_SHEET_AUXILIARY_RATIOS','mobileSheetSnapHeight'):
            self.assertIn(token, workspace)
        self.assertEqual(INDEX.count('aria-valuemax="2"'), 4)
        self.assertNotIn('aria-valuemax="1"', INDEX)

    def test_geometry_and_internal_undo_engines_remain(self):
        self.assertIn('MAX_HISTORY = 30', APP)
        merge = function_source(read_module(ROOT,'map-edit-country-commands.js'),'unionAreaWithGeometry')
        self.assertIn('untouched.push(clone(polygon))', merge)
        self.assertIn('normalizePolygonGeometry([...untouched, ...merged])', merge)
        self.assertIn('MultiPolygon', APP)
        self.assertIn('const mutateDocument = createDocumentMutationRunner({ commandPipeline })', TERRITORIAL_SERVICE)
        self.assertIn('createHistoryService', read_module(ROOT,'app-project-snapshots.js'))
        self.assertIn("undo: metadata => travelHistory('undo', metadata)", read_module(ROOT,'project-domain.js'))
        self.assertIn("redo: metadata => travelHistory('redo', metadata)", read_module(ROOT,'project-domain.js'))


if __name__ == "__main__":
    unittest.main()
