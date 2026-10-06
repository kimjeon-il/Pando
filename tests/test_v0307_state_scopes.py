from tests.application_source import function_source, node_json, read_application_sources, read_module
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP = read_application_sources(ROOT)
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

    def test_project_schema_uses_current_allowlists_and_keeps_session_state_out(self):
        root_allowlist = PROJECT_STATE[PROJECT_STATE.index("assertAllowedKeys(project, new Set(["):PROJECT_STATE.index("]), '프로젝트'")]
        for field in ("projection", "view", "layerFolders", "selectedDistributionLayerId"):
            self.assertNotIn(f"'{field}'", root_allowlist)
        self.assertIn("assertAllowedKeys(project.layerVisibility, LAYER_VISIBILITY_KEYS", PROJECT_STATE)
        self.assertIn("assertAllowedKeys(project.itemVisibility, ITEM_VISIBILITY_KEYS", PROJECT_STATE)
        self.assertIn("assertAllowedKeys(project.layerPresentation?.styles, PRESENTATION_GROUP_KEYS", PROJECT_STATE)
        self.assertIn("'countries', 'subunits', 'regions'", PROJECT_STATE)

    def test_project_and_view_use_separate_indexeddb_records(self):
        self.assertIn("readProject: () => readRecord(projectKey", PERSISTENCE)
        self.assertIn("readView: () => readRecord(viewKey", PERSISTENCE)
        self.assertIn("writeProject: project => writeRecord(projectKey", PERSISTENCE)
        self.assertIn("writeView: view => writeRecord(viewKey", PERSISTENCE)
        self.assertIn('(0, dependencies.persistence.applyAutosavedView)(autosaveRestore.view)', APP)

    def test_presentation_changes_do_not_record_document_history(self):
        settings = read_module(ROOT, 'app-map-settings.js')
        for name in ('setLayerVisibility', 'updateLayerPresentationStyle'):
            operation = function_source(settings, name)
            self.assertIn('queuePresentationAutosave', operation)
            self.assertNotIn('recordHistory', operation)
        self.assertIn('markPresentationChanged', SAVE_STATE)
        self.assertIn('documentDirty: false', SAVE_STATE)
        self.assertIn('presentationDirty: false', SAVE_STATE)

    def test_folder_expansion_is_session_only(self):
        fields = node_json(ROOT, """
        import { PROJECT_STATE_FIELDS } from './assets/js/modules/project-state.js';
        console.log(JSON.stringify(PROJECT_STATE_FIELDS));
        """)
        folders = next(field for field in fields if field['name'] == 'layerFolders')
        self.assertEqual(folders['scope'], 'session')
        self.assertFalse(folders.get('history', False))


if __name__ == "__main__":
    unittest.main()
