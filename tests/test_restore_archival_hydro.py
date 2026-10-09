"""Executable safety tests for restoring historical hydro files from Git objects."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "restore-archival-hydro.py"
spec = importlib.util.spec_from_file_location("restore_archival_hydro", SCRIPT)
assert spec and spec.loader
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def git(repo, *args):
    completed = subprocess.run(["git", "-C", str(repo), *args],
                               capture_output=True, text=True, check=True)
    return completed.stdout.strip()


class ArchivalHydroRestoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.repo = root / "source"
        self.dest = root / "external-archive"
        self.repo.mkdir()
        git(self.repo, "init", "-q")
        for version in ("v0.12.3", "v0.12.4"):
            folder = self.repo / "assets" / "data" / "hydro" / version
            folder.mkdir(parents=True)
            (folder / "manifest.json").write_text(json.dumps({"version": version}))
            (folder / "shards").mkdir()
            (folder / "shards" / "s0.bin").write_bytes(("old-"+version).encode())
        git(self.repo, "add", "assets/data/hydro")
        git(self.repo, "-c", "user.email=test@example.org", "-c", "user.name=Test",
            "commit", "-q", "-m", "historical snapshots")
        self.commit = git(self.repo, "rev-parse", "HEAD")

    def tearDown(self):
        self.temp.cleanup()

    def test_restore_outside_checkout_and_reverify_idempotently(self):
        result = helper.restore_archive(self.repo, self.dest, commit=self.commit,
                                        versions=["v0.12.3", "v0.12.4"])
        self.assertEqual(result["fileCount"], 4)
        self.assertEqual(result["restored"], 4)
        self.assertEqual(result["alreadyMatching"], 0)
        self.assertTrue((self.dest / "hydro" / "v0.12.3" / "manifest.json").exists())
        self.assertFalse((self.repo / "hydro-restore-provenance.json").exists())
        again = helper.restore_archive(self.repo, self.dest, commit=self.commit,
                                       versions=["v0.12.3", "v0.12.4"])
        self.assertEqual(again["restored"], 0)
        self.assertEqual(again["alreadyMatching"], 4)

    def test_tampering_fails_instead_of_overwriting(self):
        helper.restore_archive(self.repo, self.dest, commit=self.commit,
                               versions=["v0.12.3"])
        file = self.dest / "hydro" / "v0.12.3" / "manifest.json"
        file.write_bytes(b"altered input")
        with self.assertRaises(FileExistsError):
            helper.restore_archive(self.repo, self.dest, commit=self.commit,
                                   versions=["v0.12.3"])

    def test_refuse_writing_inside_project_and_unknown_versions(self):
        with self.assertRaises(ValueError):
            helper.restore_archive(self.repo, self.repo / "assets" / "data",
                                   commit=self.commit, versions=["v0.12.3"])
        with self.assertRaises(ValueError):
            helper.list_historical_files(self.repo, self.commit, ["v0.12.2"])

    def test_reject_bad_git_tree_sha(self):
        with self.assertRaises(ValueError):
            helper.list_historical_files(self.repo, "main", ["v0.12.4"])


if __name__ == "__main__":
    unittest.main()
