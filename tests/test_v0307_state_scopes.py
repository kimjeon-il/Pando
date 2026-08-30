import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "assets/js/app.js").read_text(encoding="utf-8")
PROJECT_STATE = (ROOT / "assets/js/modules/project-state.js").read_text(encoding="utf-8")
SAVE_STATE = (ROOT / "assets/js/modules/save-state-controller.js").read_text(encoding="utf-8")
PERSISTENCE = (ROOT / "assets/js/modules/persistence-service.js").read_text(encoding="utf-8")


class StateScopeContractTests(unittest.TestCase):
    def test_project_history_presentation_and_session_have_explicit_scopes(self):
        for scope in ("document", "presentation", "session"):
            self.assertIn(f"scope: '{scope}'", PROJECT_STATE)
        self.assertIn("['document', 'presentation'].includes(field.scope)", PROJECT_STATE)
        self.assertIn("field.scope === 'document'", PROJECT_STATE)
        self.assertIn("field.scope === 'presentation'", PROJECT_STATE)
        self.assertIn("field.scope === 'session'", PROJECT_STATE)

    def test_project_schema_rejects_session_state_and_model_visibility(self):
        for field in ("projection", "view", "layerFolders", "selectedDistributionLayerId"):
            self.assertIn(f"'{field}'", PROJECT_STATE)
        self.assertIn("['pandolab_folder_id', 'visible']", PROJECT_STATE)
        self.assertIn("['distributionType', 'parent_id', 'valid_from', 'valid_to', 'visible']", PROJECT_STATE)

    def test_project_and_view_use_separate_indexeddb_records(self):
        self.assertIn("readProject: () => readRecord(projectKey", PERSISTENCE)
        self.assertIn("readView: () => readRecord(viewKey", PERSISTENCE)
        self.assertIn("writeProject: project => writeRecord(projectKey", PERSISTENCE)
        self.assertIn("writeView: view => writeRecord(viewKey", PERSISTENCE)
        self.assertIn("applyAutosavedView(autosaveRestore.view)", APP)

    def test_presentation_changes_do_not_record_document_history(self):
        visibility = APP[APP.index("function setLayerVisibility"):APP.index("const LAYER_STYLE_TARGETS")]
        style = APP[APP.index("function updateLayerPresentationStyle"):APP.index("function setMapPanelView")]
        self.assertIn("queuePresentationAutosave()", visibility)
        self.assertNotIn("recordHistory", visibility)
        self.assertIn("queuePresentationAutosave()", style)
        self.assertNotIn("recordHistory", style)
        self.assertIn("markPresentationChanged", SAVE_STATE)
        self.assertIn("documentDirty: false", SAVE_STATE)
        self.assertIn("presentationDirty: false", SAVE_STATE)

    def test_folder_expansion_is_session_only(self):
        handler = APP[APP.index("toggleTerritorialUnitFolder: folderKey => {"):APP.index("selectItem:", APP.index("toggleTerritorialUnitFolder: folderKey => {"))]
        self.assertIn("state.layerFolders", handler)
        self.assertNotIn("queueAutosave", handler)
        self.assertNotIn("queuePresentationAutosave", handler)


if __name__ == "__main__":
    unittest.main()
