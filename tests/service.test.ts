import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { RekognitionClient } from '@aws-sdk/client-rekognition';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
process.env.TABLE_NAME='test-registry';process.env.COLLECTION_ID='test-faces';process.env.SIMILARITY_THRESHOLD='95';
const { register, recognize, remove } = await import('../backend/shared/service.js');
const bytes=Buffer.from([255,216,255,0]);
test('AWS adapter contracts and recovery states (mocked, no real biometrics)', async t=>{
  let rkCalls:string[]=[];let dbCalls:string[]=[];
  let faces=1;let row:Record<string,unknown>|undefined;let deleteFails=false;
  mock.method(RekognitionClient.prototype,'send',async(command:{constructor:{name:string};input:Record<string,unknown>})=>{
    const name=command.constructor.name;rkCalls.push(name);
    if(name==='DetectFacesCommand')return{FaceDetails:Array.from({length:faces},()=>({}))};
    if(name==='IndexFacesCommand')return{FaceRecords:[{Face:{FaceId:'face-1'}}]};
    if(name==='SearchFacesByImageCommand')return{FaceMatches:row?[{Face:{FaceId:'face-1',ExternalImageId:row.externalId},Similarity:98.5}]:[]};
    if(name==='ListFacesCommand')return{Faces:[{FaceId:'face-1',ExternalImageId:row?.externalId}]};
    if(name==='DeleteFacesCommand'){if(deleteFails){const e=Error('Simulated AWS permission failure');e.name='AccessDeniedException';throw e;}return{DeletedFaces:['face-1']};}
    throw Error(name);
  });
  mock.method(DynamoDBDocumentClient.prototype,'send',async(command:{constructor:{name:string};input:Record<string,any>})=>{
    const name=command.constructor.name;dbCalls.push(name);
    if(name==='PutCommand'){if(row){const e=Error('duplicate');e.name='ConditionalCheckFailedException';throw e;}row=structuredClone(command.input.Item);return{};}
    if(name==='GetCommand')return{Item:row};
    if(name==='ScanCommand')return{Items:row?[row]:[]};
    if(name==='UpdateCommand'){row={...row,status:command.input.ExpressionAttributeValues[':state'],...(command.input.ExpressionAttributeValues[':face']?{faceId:command.input.ExpressionAttributeValues[':face']}:{})};return{};}
    if(name==='DeleteCommand'){row=undefined;return{};}throw Error(name);
  });
  await t.test('rejects zero or multiple faces before reserving identity',async()=>{for(faces of [0,2])await assert.rejects(register('A','Test',bytes,'admin'),/exactamente/);assert.equal(dbCalls.length,0);faces=1;});
  await t.test('registers one face with durable reservation',async()=>{const result=await register('A','Test',bytes,'admin');assert.equal(result.status,'REGISTERED');assert.equal(row?.status,'REGISTERED');assert.equal(dbCalls[0],'PutCommand');assert.ok(rkCalls.includes('IndexFacesCommand'));});
  await t.test('rejects duplicate identity',async()=>{await assert.rejects(register('A','Test',bytes,'admin'),/identificador/);});
  await t.test('recognized result uses registered metadata',async()=>{const result=await recognize(bytes,95);assert.equal(result.recognized,true);assert.equal(result.data.userId,'A');});
  await t.test('clients cannot weaken threshold',async()=>{await assert.rejects(recognize(bytes,90),/umbral/);});
  await t.test('failed deletion preserves recoverable metadata',async()=>{deleteFails=true;await assert.rejects(remove('A'));assert.equal(row?.status,'DELETING');assert.ok(row?.externalId);});
  await t.test('recognition cannot return a deleting identity',async()=>{await assert.rejects(recognize(bytes,95),/cambiando/);});
  await t.test('retry completes deletion; absent identity is idempotent',async()=>{deleteFails=false;assert.equal((await remove('A')).deleted,true);assert.equal(row,undefined);assert.equal((await remove('A')).alreadyAbsent,true);});
  await t.test('unknown face is an explicit negative result',async()=>{assert.equal((await recognize(bytes,95)).recognized,false);});
  mock.restoreAll();
});
