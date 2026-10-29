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

    def test_failed_qgis_execution_is_visible(self):
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

    def test_export_uses_node_normalization_and_reports_failures(self):
        class Client:
            def __init__(self, coords):
                self.coords = coords
            def execute_code(self, destination):
                collection = dict(type='FeatureCollection', features=[dict(type='Feature', id='qgis-fid',
                    geometry=dict(type='Point', coordinates=self.coords),
                    properties=dict(source=json.dumps(dict(schemaVersion=1, sourceId='원본'))))])
                pathlib.Path(destination).write_text(json.dumps(collection, ensure_ascii=False), encoding='utf-8')
                return dict(status='success', result=dict(executed=True))
        with tempfile.TemporaryDirectory() as folder, patch.object(bridge, 'export_code', side_effect=lambda path, layer: str(path)):
            output = pathlib.Path(folder) / 'result.geojson'
            bridge.export_layer(Client([127, 37]), 'layer', output)
            result = json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(result['features'][0]['id'], 'qgis-fid')
            self.assertEqual(result['features'][0]['properties']['source']['sourceId'], '원본')
            saved = output.read_bytes()
            with self.assertRaises(FileExistsError):
                bridge.export_layer(Client([127, 37]), 'layer', output)
            self.assertEqual(output.read_bytes(), saved)
            invalid = pathlib.Path(folder) / 'invalid.geojson'
            with self.assertRaisesRegex(RuntimeError, 'coordinate'):
                bridge.export_layer(Client([300000, 400000]), 'layer', invalid)
            self.assertFalse(invalid.exists())


if __name__ == '__main__':
    unittest.main()
