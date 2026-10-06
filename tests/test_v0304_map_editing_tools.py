from tests.application_source import element_markup, function_source, node_json, read_application_sources, read_module, read_ui_sources
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
APP = read_application_sources(ROOT)
CSS = read_ui_sources(ROOT)
SNAP = (ROOT / "assets" / "js" / "modules" / "geometry-snap.js").read_text(encoding="utf-8")
TOOLS = (ROOT / "assets" / "js" / "modules" / "tool-controller.js").read_text(encoding="utf-8")


class MapEditingToolsV0304Tests(unittest.TestCase):
    def test_object_actions_are_visible_and_border_coast_tools_are_separate(self):
        entity = element_markup(INDEX,'entityProperties')
        order = [entity.index(f'id="{element_id}"') for element_id in ('annexEntityBtn','mergeEntityBtn','editEntityBorderBtn','editEntityCoastBtn')]
        self.assertEqual(order, sorted(order))
        for element_id in ('redrawEntityBtn','reconcileEntityCoastBtn','copyEntityRegionBtn'):
            self.assertIn('editor-action-row', element_markup(entity,element_id))
        self.assertNotIn('고급 작업', INDEX)
        self.assertIn("'territorial-border'", TOOLS)
        self.assertIn("'country-coast'", TOOLS)
        self.assertIn('boundaryEditEntityIds', APP)

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
        result = node_json(ROOT, r"""
        import { draftToolbarStatus } from './assets/js/modules/app-task-presentation.js';
        const state={geometryPreview:{session:null},modeProcessing:false};
        const draft={coords:[[0,0],[1,0],[1,1]],issues:[],inputPhase:'refine',selectedVertexIndex:1,strokeActive:false,dragging:false};
        const args={state,draft,draftMode:'polygon',hasDraftTool:true,minimumPoints:3,cutLineReady:true};
        const normal=draftToolbarStatus(args);
        const unselected=draftToolbarStatus({...args,draft:{...draft,selectedVertexIndex:null}});
        const busy=draftToolbarStatus({...args,state:{...state,modeProcessing:true}});
        const invalid=draftToolbarStatus({...args,draft:{...draft,issues:['self-intersection']}});
        const short=draftToolbarStatus({...args,draft:{...draft,coords:[[0,0]]}});
        console.log(JSON.stringify({normal,unselected,busy,invalid,short}));
        """)
        self.assertTrue(all(result['normal'][key] for key in ('visible','editable','insert','remove','redraw','complete')))
        self.assertFalse(result['unselected']['remove'])
        for key in ('insert','remove','redraw','complete'):
            self.assertFalse(result['busy'][key])
        self.assertFalse(result['invalid']['complete'])
        self.assertFalse(result['short']['complete'])
        for action in ('modeDraftRedrawBtn','modeDraftInsertBtn','modeDraftDeleteBtn','modeDraftDoneBtn'):
            self.assertEqual(INDEX.count(f'id="{action}"'),1)
        self.assertIn('performDraftUndo', APP)
        self.assertIn('performDraftRedo', APP)

    def test_multi_selection_uses_common_property_inputs_and_header_menu_delete(self):
        self.assertNotIn('multiPropertiesVisibilityInput', INDEX + APP)
        self.assertIn('id="objectVisibilityBtn"', INDEX)
        self.assertIn('deleteSelectedFromObjectMenu', APP)
        self.assertIn('id="multiPropertiesColorTrigger"', INDEX)
        self.assertEqual(INDEX.count('id="objectDeleteBtn"'),1)
        self.assertIn('editorDeleteSection', element_markup(INDEX,'editorScrollBody'))

    def test_processing_state_is_session_only_and_width_stable(self):
        source = read_module(ROOT,'app-task-presentation.js')
        action = function_source(source,'runModePrimaryAction')
        self.assertIn('if (dependencies.projectState.state.modeProcessing) return false', action)
        self.assertIn('dependencies.projectState.state.modeProcessing = true', action)
        self.assertIn('finally', action)
        self.assertIn('dependencies.projectState.state.modeProcessing = false', action)
        self.assertIn('class="mode-button-busy"', INDEX)
        self.assertIn('.mode-primary-btn', CSS)
        serializer = read_module(ROOT,'project-serializer.js')
        self.assertNotIn('modeProcessing', serializer)


if __name__ == "__main__":
    unittest.main()
