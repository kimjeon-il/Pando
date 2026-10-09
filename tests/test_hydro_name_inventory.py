import importlib.util
import pathlib
import unittest
spec = importlib.util.spec_from_file_location('audit', pathlib.Path(__file__).parents[1] / 'tools/inventory-hydro-names.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class InventoryTests(unittest.TestCase):
    def test_placeholders_are_not_names(self):
        for value in ['', None, '미명명 수계 123', 'river-719', 'lake-15', '123', '이름 없는 강']:
            self.assertFalse(audit.meaningful(value), value)
        for value in ['Lake Victoria', 'River 1 tributary', '도나우강', 'Sông Sài Gòn']:
            self.assertTrue(audit.meaningful(value), value)

    def test_length_and_area_are_spherical_and_handle_holes(self):
        self.assertAlmostEqual(audit.length_km({'type':'LineString','coordinates':[[0,0],[1,0]]}),111.195,places=2)
        square=[[0,0],[1,0],[1,1],[0,1],[0,0]]
        area=audit.area_km2({'type':'Polygon','coordinates':[square]})
        self.assertTrue(12360 < area < 12370)
        self.assertEqual(audit.area_km2({'type':'Polygon','coordinates':[square,square]}),0)
        self.assertAlmostEqual(audit.length_km({'type':'LineString','coordinates':[[179.5,0],[-179.5,0]]}),111.195,places=2)

if __name__ == '__main__': unittest.main()
