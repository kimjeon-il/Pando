import unittest

from tests.application_source import function_source


class CurrentSourceExtractionTests(unittest.TestCase):
    def test_multiline_parameters_and_nested_blocks_do_not_truncate_owner(self):
        source = """export async function operation({
  defaults = {},
}) {
  if (defaults.enabled) {
    return { result: true };
  }
  return { result: false };
}
function following() {
  return null;
}
"""
        owner = function_source(source, 'operation')
        self.assertIn('return { result: false };', owner)
        self.assertTrue(owner.startswith('export async function operation('))
        self.assertTrue(owner.endswith('}'))
        self.assertNotIn('following', owner)
        with self.assertRaises(ValueError):
            function_source(source, 'missing')

if __name__ == '__main__':
    unittest.main()

