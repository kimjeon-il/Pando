import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFileController } from "../../shared/frontend/js/modules/file-controller.js";
import {renderProductHtml} from '../../scripts/lib/product-html.mjs';
import {createBrowserFileAccessFixture} from '../helpers/file-transport-fixtures.mjs';
const {File}=globalThis;



test('file inputs pass explicit source intent without changing the import target', async () => {
  const file=new File(['project'],'test.gpkg');
  const fixture=createBrowserFileAccessFixture({productMode:'editor',autoPick:false,projectFiles:()=>[file],gisFiles:()=>[file]}),elements=fixture.elements;
  const intents = [];
  const controller = createFileController({productMode:'editor',reportOperationError:error=>assert.fail(error.message), elements,fileAccess:fixture.access,readProject:async file=>file,projectDomain:{open:async read=>{intents.push('project');return read();}},onFiles:async(_files,options)=>intents.push(options.sourceKind) });
  controller.bind();
  const project=controller.openProjectPicker();fixture.fire('project','success',[file]);await project;
  const gis=controller.openPicker();fixture.fire('gis','success',[file]);await gis;
  assert.deepEqual(intents, ['project', 'vector']);
});
