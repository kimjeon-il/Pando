from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
APP = (ROOT / "assets" / "js" / "app.js").read_text(encoding="utf-8")


class LayerLockSyncTests(unittest.TestCase):
    def test_lock_changes_patch_rendered_object_rows_without_tree_invalidation(self):
        row_factory = APP[APP.index("function createLayerLockIndicator"):APP.index("function renderVirtualizedLayerGroup")]
        batch_lock = APP[APP.index("function batchSetLocked"):APP.index("function batchToggleLocked")]
        distribution_lock = APP[APP.index("function commitDistributionMeta"):APP.index("function createDistributionLayerFromPrompt")]
        territorial_lock = APP[APP.index("function setTerritorialUnitLocked"):APP.index("window.PANDOLAB_TERRITORIAL")]

        self.assertIn("function syncLayerItemLockIndicator", row_factory)
        self.assertIn("rowRef.key !== ref.key", row_factory)
        self.assertIn("row.classList.contains('has-no-menu')", row_factory)
        self.assertIn("if (hasMenu && ref && objectRefLocked(ref))", row_factory)
        self.assertIn("syncObjectLockStateChange(refs);", batch_lock)
        self.assertNotIn("markLayerTreeDirty();", batch_lock)
        self.assertIn("field === 'locked') syncObjectLockStateChange", distribution_lock)
        self.assertIn("syncObjectLockStateChange([{ domain: 'territorial', type, id: key }]);", territorial_lock)


if __name__ == "__main__":
    unittest.main()
