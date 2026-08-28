from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "assets" / "css" / "app.css").read_text(encoding="utf-8")
SNAP = (ROOT / "assets" / "js" / "modules" / "geometry-snap.js").read_text(encoding="utf-8")
TOOLS = (ROOT / "assets" / "js" / "modules" / "tool-controller.js").read_text(encoding="utf-8")


class MapEditingToolsV0304Tests(unittest.TestCase):
    def test_object_actions_are_visible_and_border_coast_tools_are_separate(self):
        self.assertNotIn("고급 작업", INDEX)
        self.assertIn("고급 설정 · 속성 연결", INDEX)
        country_order = [
            INDEX.index('id="annexTerritoryBtn"'),
            INDEX.index('id="mergeCountryBtn"'),
            INDEX.index('id="editBorderBtn"'),
            INDEX.index('id="editCoastBtn"'),
            INDEX.index('id="changeCountryTypeBtn"'),
        ]
        self.assertEqual(country_order, sorted(country_order))
        self.assertIn('id="regionGeometryActionsTitle"', INDEX)
        self.assertIn('id="regionRelationActionsTitle"', INDEX)
        self.assertIn('id="administrativeGeometryActionsTitle"', INDEX)
        self.assertIn('id="administrativeRelationActionsTitle"', INDEX)
        for ids in (
            ("reassignRegionShapeBtn", "mergeRegionBtn", "splitRegionBtn", "transferRegionBtn", "changeRegionTypeBtn", "promoteRegionBtn", "removeRegionDivisionBtn"),
            ("reassignAdministrativeShapeBtn", "mergeAdministrativeBtn", "splitAdministrativeBtn", "transferAdministrativeBtn", "changeAdministrativeTypeBtn", "promoteAdministrativeBtn", "removeAdministrativeDivisionBtn"),
            ("editDrawingBoundaryBtn", "mergeDrawingBtn", "splitDrawingBtn", "syncDrawingCoastBtn", "editDrawingCoastBtn", "applyDrawingToCountryBtn", "promoteDrawingToCountryBtn"),
        ):
            positions = [INDEX.index(f'id="{element_id}"') for element_id in ids]
            self.assertEqual(positions, sorted(positions))
        self.assertIn("'country-border'", TOOLS)
        self.assertIn("'country-coast'", TOOLS)
        self.assertIn("boundaryEditCountryIds", APP)

    def test_removed_user_tools_and_ghost_controls_are_absent(self):
        removed_ids = (
            "measureDistanceBtn", "measureAreaBtn", "mapAuditBtn", "snapSettingsBtn",
            "measureDistanceMobileBtn", "measureAreaMobileBtn", "mapAuditMobileBtn", "snapSettingsMobileBtn",
            "snapSettingsPanel", "mapAuditPanel", "modeDraftUndoBtn", "modeDraftRedoBtn", "cursorToolHelper",
            "multiVisibilityBtn", "multiLockBtn", "multiColorInput", "multiDeleteBtn",
            "multiPropertiesVisibilityBtn", "multiPropertiesLockBtn", "multiPropertiesDeleteBtn",
        )
        combined = INDEX + APP + CSS
        for element_id in removed_ids:
            self.assertNotIn(element_id, combined)

    def test_automatic_snap_policy_has_no_user_persistence_surface(self):
        self.assertNotIn("SNAP_STORAGE_KEY", SNAP)
        self.assertNotIn("normalizeSnapSettings", SNAP + APP)
        self.assertNotIn("loadSnapSettings", SNAP)
        self.assertNotIn("saveSnapSettings", SNAP)
        self.assertIn("mouse: 10", SNAP)
        self.assertIn("touch: 18", SNAP)
        self.assertNotIn("'measure-distance'", TOOLS)
        self.assertNotIn("'measure-area'", TOOLS)

    def test_draft_micro_actions_are_state_specific(self):
        self.assertIn("const refineSelection = draftMode && state.draftEdit.inputPhase === 'refine'", APP)
        self.assertIn("draftRedraw?.classList.toggle('hidden', refineSelection)", APP)
        self.assertIn("draftRemoveLast?.classList.toggle('hidden', refineSelection)", APP)
        self.assertIn("draftDelete?.classList.toggle('hidden', !refineSelection)", APP)
        self.assertIn("if (draftInputActive())", APP)
        self.assertIn("performDraftUndo();", APP)
        self.assertIn("performDraftRedo();", APP)

    def test_multi_selection_uses_common_property_inputs_and_header_menu_delete(self):
        self.assertIn('id="multiPropertiesVisibilityInput"', INDEX)
        self.assertIn('id="multiPropertiesLockInput"', INDEX)
        self.assertIn("input.indeterminate", APP)
        self.assertIn("deleteSelectedFromObjectMenu", APP)
        self.assertIn("width: min(100%, 360px);", CSS)

    def test_processing_state_is_session_only_and_width_stable(self):
        self.assertIn("modeProcessing: false", APP)
        self.assertIn("async function runModePrimaryAction", APP)
        self.assertIn("if (state.modeProcessing) return false", APP)
        self.assertIn('class="mode-button-busy"', INDEX)
        self.assertIn(".mode-primary-btn { position: relative; min-width: 112px; }", CSS)
        self.assertNotIn("modeProcessing:", APP[APP.index("function buildAtlasState()"):APP.index("function buildAutosaveData()")])


if __name__ == "__main__":
    unittest.main()
