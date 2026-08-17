#!/usr/bin/env python3
from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from validate_skill import validate_rule_ownership


class RuleOwnershipTest(unittest.TestCase):
    def copy_skill(self, target: Path) -> Path:
        copied = target / "Hi-Builder"
        shutil.copytree(ROOT, copied, ignore=shutil.ignore_patterns("output", "__pycache__", ".DS_Store"))
        return copied

    def test_current_rule_ownership_passes(self) -> None:
        self.assertEqual(validate_rule_ownership(ROOT), [])

    def test_duplicate_exclusive_rule_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            skill_path = copied / "SKILL.md"
            skill_path.write_text(skill_path.read_text(encoding="utf-8") + "\n禁止使用ElMessage。\n", encoding="utf-8")
            errors = validate_rule_ownership(copied)
            self.assertTrue(any("独占规则文本出现在非权威文档" in error for error in errors), errors)

    def test_copied_machine_fact_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            skill_path = copied / "SKILL.md"
            skill_path.write_text(skill_path.read_text(encoding="utf-8") + "\n运行版本为2.7.16。\n", encoding="utf-8")
            errors = validate_rule_ownership(copied)
            self.assertTrue(any("机器事实不得复制到治理文档" in error for error in errors), errors)

    def test_navigation_document_cannot_copy_exclusive_rule(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            readme_path = copied / "README.md"
            readme_path.write_text(
                readme_path.read_text(encoding="utf-8") + "\n禁止使用ElMessage。\n",
                encoding="utf-8",
            )
            errors = validate_rule_ownership(copied)
            self.assertTrue(
                any("独占规则文本不得复制到导航文档" in error for error in errors),
                errors,
            )

    def test_navigation_document_cannot_copy_machine_fact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = self.copy_skill(Path(directory))
            readme_path = copied / "README.md"
            readme_path.write_text(
                readme_path.read_text(encoding="utf-8") + "\n运行版本为2.7.16。\n",
                encoding="utf-8",
            )
            errors = validate_rule_ownership(copied)
            self.assertTrue(
                any("机器事实不得复制到导航文档" in error for error in errors),
                errors,
            )


if __name__ == "__main__":
    unittest.main()
