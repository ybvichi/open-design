import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from compile_pattern_page import compile_pattern_page
from core import load_json
from validate_pattern_page import validate_pattern_html


class ShiftHandoverDetailsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.spec = load_json(ROOT / "output/shift-handover-management.spec.json")
        self.html = compile_pattern_page(self.spec)

    def test_detail_action_toggles_linked_handover_details(self) -> None:
        self.assertIn('class="table-detail-pane"', self.html)
        self.assertIn("交接信息", self.html)
        self.assertIn("移交事项", self.html)
        self.assertIn("detailPaneVisible", self.html)
        self.assertIn("this.selectedDetailRow.id === row.id", self.html)
        self.assertIn("this.detailPaneVisible = false", self.html)
        self.assertNotIn("table-detail-pane__header", self.html)

    def test_generated_page_passes_pattern_validation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            html_path = Path(directory) / "shift-handover-management.html"
            html_path.write_text(self.html, encoding="utf-8")
            self.assertEqual(validate_pattern_html(self.spec, html_path), [])


if __name__ == "__main__":
    unittest.main()
