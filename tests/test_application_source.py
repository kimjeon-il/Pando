import unittest

from tests.application_source import element_markup, function_source


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

    def test_nested_elements_remain_in_their_current_owner(self):
        source = '<section id="editor"><section><input id="name" disabled /></section><p>Notes</p></section><section id="other">Other</section>'
        self.assertEqual(element_markup(source, 'name'), '<input id="name" disabled />')
        editor = element_markup(source, 'editor')
        self.assertIn('<p>Notes</p>', editor)
        self.assertNotIn('Other', editor)
        with self.assertRaises(ValueError):
            element_markup(source, 'retired')


if __name__ == '__main__':
    unittest.main()
