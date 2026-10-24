import copy
import importlib.util
import io
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

MODULE = pathlib.Path(__file__).resolve().parents[2] / 'tools/qgis/bridge.py'
spec = importlib.util.spec_from_file_location('qgis_bridge', MODULE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class QgisBridgeTests(unittest.TestCase):
    def test_cli_emits_utf8_even_with_a_korean_windows_console(self):
        buffer = io.BytesIO()
        console = io.TextIOWrapper(buffer, encoding='cp949')
        with patch.object(bridge, 'connect') as connecting, patch.object(bridge, 'load_config', return_value={}), \
                patch.object(sys, 'argv', ['bridge', 'status']), patch.object(sys, 'stdout', console):
            connecting.return_value.get_qgis_info.return_value = dict(status='success', result=dict(title='지도—خريطة'))
            bridge.main()
            console.flush()
            self.assertEqual(json.loads(buffer.getvalue().decode('utf-8'))['title'], '지도—خريطة')

    def test_upstream_false_connection_is_a_retryable_failure(self):
        with patch('qgis_mcp.client.QgisMCPClient') as upstream:
            upstream.return_value.connect.return_value = False
            with self.assertRaises(ConnectionError):
                bridge.connect(dict(host='127.0.0.1', port=9876, token='test-only'))

    def sample(self):
        return dict(type='FeatureCollection', features=[dict(type='Feature', id='qgis-fid',
                    geometry=dict(type='LineString', coordinates=[[127, 37], [128, 38]]),
                    properties=dict(name='경계', source=json.dumps(dict(schemaVersion=1, kind='gis',
                        sourceId='original', details=dict(licence='retained', reviewed=False)))) )])

    def test_exchange_restores_nested_qgis_json_without_mutating_input(self):
        original = self.sample()
        before = copy.deepcopy(original)
        result = bridge.normalize_exchange(original)
        self.assertEqual(original, before)
        self.assertEqual(result['features'][0]['properties']['source']['sourceId'], 'original')
        self.assertEqual(result['features'][0]['geometry'], before['features'][0]['geometry'])
        self.assertEqual(result['features'][0]['id'], 'qgis-fid', 'Pando owns internal-ID replacement')

    def test_exchange_rejects_projected_or_nonfinite_coordinates(self):
        original = self.sample()
        original['crs'] = dict(type='name', properties=dict(name='EPSG:3857'))
        with self.assertRaisesRegex(ValueError, 'EPSG:4326'):
            bridge.normalize_exchange(original)
        original.pop('crs')
        original['features'][0]['geometry']['coordinates'][0] = [300000, 400000]
        with self.assertRaisesRegex(ValueError, 'coordinate'):
            bridge.normalize_exchange(original)
        original['features'][0]['geometry']['coordinates'][0] = [float('nan'), 37]
        with self.assertRaisesRegex(ValueError, 'coordinate'):
            bridge.normalize_exchange(original)

    def test_exchange_preserves_unknown_source_and_rejects_missing_geometry(self):
        original = self.sample()
        original['features'][0]['properties']['source'] = 'OpenStreetMap'
        self.assertEqual(bridge.normalize_exchange(original)['features'][0]['properties']['source'], 'OpenStreetMap')
        original['features'][0]['geometry'] = None
        with self.assertRaisesRegex(ValueError, 'geometry'):
            bridge.normalize_exchange(original)

    def test_output_is_exclusive_and_failed_qgis_execution_is_visible(self):
        with tempfile.TemporaryDirectory() as folder:
            output = pathlib.Path(folder) / 'out.geojson'
            bridge.write_exchange(output, self.sample())
            saved = output.read_bytes()
            with self.assertRaises(FileExistsError):
                bridge.write_exchange(output, self.sample())
            self.assertEqual(output.read_bytes(), saved)
        for response in [dict(status='error', message='failed'),
                         dict(status='success', result=dict(executed=False, error='script failed'))]:
            with self.assertRaisesRegex(RuntimeError, 'failed'):
                bridge.accept_code_result(response)

    def test_export_code_uses_literal_paths_and_explicit_wgs84(self):
        path = "D:/지도/it's [a] map.geojson"
        code = bridge.export_code(path, "layer'quoted")
        compile(code, '<qgis-export>', 'exec')
        self.assertIn(repr(path), code)
        self.assertIn(repr("layer'quoted"), code)
        self.assertIn('EPSG:4326', code)
        self.assertIn('RFC7946=YES', code)

    def test_failed_export_removes_only_its_exclusive_temporary_directory(self):
        class FailedClient:
            def execute_code(self, code):
                raise RuntimeError('operation failed')
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            existing = root / 'keep.geojson'
            existing.write_text('unfinished user data')
            with self.assertRaisesRegex(RuntimeError, 'operation failed'):
                bridge.export_layer(FailedClient(), 'layer', root / 'result.geojson')
            self.assertEqual(list(root.iterdir()), [existing])
            self.assertEqual(existing.read_text(), 'unfinished user data')


if __name__ == '__main__':
    unittest.main()
