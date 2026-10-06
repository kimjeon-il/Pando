from __future__ import annotations
from tests.application_source import function_source, read_application_sources, read_module

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = read_application_sources(ROOT)
LAYER_TREE = (ROOT / "assets" / "js" / "modules" / "layer-tree-controller.js").read_text(encoding="utf-8")


class LayerLockSyncTests(unittest.TestCase):
    def test_lock_changes_patch_rendered_object_rows_without_tree_invalidation(self):
        commands = read_module(ROOT, 'app-object-commands.js')
        batch = function_source(commands, 'batchSetLocked')
        self.assertIn('syncLocks(refs)', batch)
        self.assertNotIn('markLayerTreeDirty', batch)
        search_row = function_source(LAYER_TREE, 'rowFor')
        self.assertNotIn('locked', search_row)
        self.assertNotIn('Lock', search_row)
        self.assertIn('objectRefLocked', APP)
        self.assertIn('presentPrimary({ refreshOnly: true })', batch)
        self.assertIn('syncBatchActionAvailability', batch)


if __name__ == "__main__":
    unittest.main()
