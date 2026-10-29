import importlib.util
import pathlib
import tempfile
import unittest
import pymupdf

ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('map_raster',ROOT/'plugins/pando-map-tools/lib/raster.py')
raster=importlib.util.module_from_spec(spec);spec.loader.exec_module(raster)
WKT='PROJCS["fixture",GEOGCS["NAD83",DATUM["NAD83",SPHEROID["GRS_1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["Central_Meridian",-95],PARAMETER["Latitude_Of_Origin",49],PARAMETER["Standard_Parallel_1",49],PARAMETER["Standard_Parallel_2",77],UNIT["Meter",1]]'

class GeoPdfTests(unittest.TestCase):
    def test_embedded_viewport_preserves_original_uvs_and_four_real_controls(self):
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'map.pdf'
            with pymupdf.open() as doc:
                page=doc.new_page(width=200,height=100)
                viewport='[<</Type/Viewport/BBox[0 0 200 100]/Measure<</Type/Measure/Subtype/GEO/LPTS[0 0 0 1 1 1 1 0]/GPTS[40 -120 70 -120 70 -60 40 -60]/GCS<</Type/PROJCS/WKT('+WKT+')>>>>>>]'
                doc.xref_set_key(page.xref,'VP',viewport);doc.save(path)
            image,metadata=raster.source({'path':str(path)})
            value=metadata['georeference']
            self.assertEqual(value['projection']['kind'],'lcc')
            self.assertEqual(value['projection']['ellipsoid'],'GRS80')
            self.assertEqual(len(value['controlPoints']),4)
            self.assertEqual(value['controlPoints'][0]['image'],[0.,1.])
            self.assertEqual(value['controlPoints'][0]['coordinate'],[-120.,40.])
            self.assertEqual(image.size,(400,200))
            self.assertFalse(value['independentChecks'])

    def test_unsupported_wkt_does_not_silently_become_geographic(self):
        self.assertIsNone(raster.geopdf_projection(WKT.replace('Lambert_Conformal_Conic','Transverse_Mercator')))
        self.assertIsNone(raster.geopdf_projection(WKT.replace('UNIT["Meter",1]','UNIT["Foot",0.3048]')))

    def test_non_greenwich_and_unsupported_axis_units_are_not_treated_as_degrees(self):
        self.assertIsNone(raster.geopdf_projection(WKT.replace('PRIMEM["Greenwich",0]','PRIMEM["Paris",2.33722917]')))
        self.assertIsNone(raster.geopdf_projection(WKT.replace('UNIT["Degree",0.0174532925199433]','UNIT["Grad",0.015707963267948967]')))

if __name__=='__main__':unittest.main()
