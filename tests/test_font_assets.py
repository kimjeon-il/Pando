import hashlib
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FONT_DIR = ROOT / 'assets/fonts/pretendard-v1.3.9'


class FontAssetTests(unittest.TestCase):
    def test_bundled_pretendard_bytes_and_license(self):
        font = FONT_DIR / 'PretendardVariable.woff2'
        self.assertEqual(
            hashlib.sha256(font.read_bytes()).hexdigest(),
            '9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4',
        )
        license_text = (FONT_DIR / 'LICENSE.txt').read_text(encoding='utf-8')
        self.assertIn('SIL OPEN FONT LICENSE', license_text.upper())


if __name__ == '__main__':
    unittest.main()
