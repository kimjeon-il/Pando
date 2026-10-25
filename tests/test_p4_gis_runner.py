"""Tests for the isolated GIS entry point; no spatial dependencies or source data."""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "scripts" / "gis" / "run-source.py"


class GisRunnerIsolationTests(unittest.TestCase):
    def test_dry_run_does_not_launch_dem_or_download_sources(self):
        completed = subprocess.run(
            [sys.executable, str(RUNNER), "--task", "terrain-dem", "--",
             "--etopo", "/not-mounted/source.tif", "--output", "/tmp/p4-fake-output"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        result = json.loads(completed.stdout)
        self.assertEqual(result["mode"], "dry-run")
        self.assertEqual(result["source"], "tools/build-terrain-dem.py")
        self.assertIn("/not-mounted/source.tif", result["argv"])

    def test_hydro_and_historical_are_explicitly_allowlisted(self):
        for task, path in (
            ("hydro-tiles", "tools/build-hydro-tiles.py"),
            ("hydro-packfile", "tools/build-hydro-packfile.mjs"),
            ("historical-border", "tools/build_german_empire_1914_base.py"),
        ):
            with self.subTest(task=task):
                result = subprocess.run([sys.executable, str(RUNNER), "--task", task],
                                        cwd=ROOT, capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)["source"], path)

    def test_retired_siachen_task_is_not_dispatchable(self):
        result = subprocess.run(
            [sys.executable, str(RUNNER), "--task", "historical-topography-probe"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid choice", result.stderr)

    def test_arbitrary_python_execution_is_not_supported(self):
        result = subprocess.run([sys.executable, str(RUNNER), "--task",
                                 "scripts/backdoor.py", "--execute"],
                                cwd=ROOT, capture_output=True, text=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid choice", result.stderr)


if __name__ == "__main__":
    unittest.main()
