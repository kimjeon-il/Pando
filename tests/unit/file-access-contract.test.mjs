import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertFileAccessPort,assertFileWriteReceipt,assertGisFileSelection,
  assertProjectFileSelection,assertProjectSaveDestination,
} from '../../shared/frontend/js/modules/file-access-contract.js';
import {createBrowserFileAccessFixture,createNativeFileAccessFixture} from '../helpers/file-transport-fixtures.mjs';

const {Blob}=globalThis;

function registerEditorFileAccessContract(name,fixtureFactory){
  test(name+' satisfies the shared editor file-access contract',async()=>{
    const f=fixtureFactory(),access=assertFileAccessPort(f.access,{productMode:'editor'});

    f.set('project','cancel');
    assert.equal(assertProjectFileSelection(await access.openProjectFile()).cancelled,true);
    f.set('project','success');
    const project=assertProjectFileSelection(await access.openProjectFile());
    assert.equal(project.cancelled,false);assert.equal(project.file.name,'project.gpkg');

    f.set('gis','cancel');
    assert.equal(assertGisFileSelection(await access.openGisFiles()).cancelled,true);
    f.set('gis','success');
    const gis=assertGisFileSelection(await access.openGisFiles());
    assert.deepEqual(gis.files.map(file=>file.name),['map.shp','map.dbf']);

    const blob=new Blob(['project-bytes']);
    const destination=assertProjectSaveDestination(await access.prepareProjectSave());
    const saved=assertFileWriteReceipt(await destination.write(blob));
    assert.equal(typeof saved.downloaded,'boolean');
    await assert.rejects(destination.write(blob),/finished/i);

    const exported=assertFileWriteReceipt(await access.saveExportFile('판도연구소-GIS-데이터.gpkg',new Blob(['GIS'])));
    assert.equal(typeof exported.downloaded,'boolean');
    access.dispose?.();
  });
}

registerEditorFileAccessContract('browser transport',()=>{const fixture=createBrowserFileAccessFixture();fixture.access.bind({onProjectFile(){},onGisFiles(){},onError:error=>{throw error;}});return fixture;});
registerEditorFileAccessContract('native transport',createNativeFileAccessFixture);

test('shared file-access result validators fail closed on malformed transport output',()=>{
  assert.throws(()=>assertProjectFileSelection({cancelled:false,file:new Blob(['x'])}),/named File/);
  assert.throws(()=>assertGisFileSelection({cancelled:false,files:[]}),/requires files/);
  assert.throws(()=>assertProjectSaveDestination({write(){}}),/abort/);
  assert.throws(()=>assertFileWriteReceipt({downloaded:'yes'}),/downloaded/);
});
