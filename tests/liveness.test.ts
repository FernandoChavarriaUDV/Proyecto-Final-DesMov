import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {RekognitionClient} from '@aws-sdk/client-rekognition';
import {CognitoIdentityClient} from '@aws-sdk/client-cognito-identity';
import type {APIGatewayProxyEvent} from 'aws-lambda';
process.env.SESSIONS_TABLE='sessions';process.env.IDENTITY_POOL_ID='test-pool';process.env.USER_POOL_ID='test-users';process.env.TABLE_NAME='registry';process.env.LIVENESS_THRESHOLD='90';
const {createLiveness,livenessResult}=await import('../backend/shared/liveness.js');
const {handler}=await import('../backend/lambdas/recognize-face/index.js');
test('liveness authorization and decisions (AWS simulated)',async t=>{
  const sid='12345678-1234-1234-1234-123456789abc';
  const sessions=new Map<string,Record<string,any>>();let calls:string[]=[];let state='SUCCEEDED';let confidence=99;
  const reset=()=>{sessions.clear();sessions.set(sid,{sessionId:sid,owner:'alice',status:'CREATED',expiresAt:Math.floor(Date.now()/1000)+180});calls=[];state='SUCCEEDED';confidence=99;};
  mock.method(DynamoDBDocumentClient.prototype,'send',async(c:{constructor:{name:string};input:any})=>{
    const i=c.input;const name=c.constructor.name;
    if(name==='ScanCommand')return{Items:[{userId:'USR1',name:'Test',externalId:'external',faceId:'face1',status:'REGISTERED'}]};
    if(name==='GetCommand')return{Item:sessions.get(i.Key.sessionId)};
    if(name==='PutCommand'){sessions.set(i.Item.sessionId,structuredClone(i.Item));return{};}
    if(name==='UpdateCommand'){
      const row=sessions.get(i.Key.sessionId)!;const v=i.ExpressionAttributeValues;
      if(v[':processing']){if(row.status==='PROCESSING' && row.leaseUntil>Date.now()/1000){const e=Error();e.name='ConditionalCheckFailedException';throw e;}Object.assign(row,{status:'PROCESSING',leaseId:v[':lease'],leaseUntil:v[':until']});}
      if(v[':outcome'])Object.assign(row,{status:'COMPLETE',outcome:v[':outcome']});
      if(v[':created']&&!v[':processing'])row.status='CREATED';return{};
    }
    throw Error(name);
  });
  mock.method(CognitoIdentityClient.prototype,'send',async(c:{constructor:{name:string}})=>c.constructor.name==='GetIdCommand'?{IdentityId:'identity'}:{Credentials:{AccessKeyId:'test-access',SecretKey:'test-secret',SessionToken:'test-session',Expiration:new Date(Date.now()+3600000)}});
  mock.method(RekognitionClient.prototype,'send',async(c:{constructor:{name:string}})=>{
    const name=c.constructor.name;calls.push(name);
    if(name==='CreateFaceLivenessSessionCommand')return{SessionId:sid};
    if(name==='GetFaceLivenessSessionResultsCommand')return{Status:state,Confidence:confidence,ReferenceImage:{Bytes:Buffer.from([255,216,255])}};
    if(name==='DetectFacesCommand')return{FaceDetails:[{}]};
    if(name==='SearchFacesByImageCommand')return{FaceMatches:[{Face:{FaceId:'face1',ExternalImageId:'external'},Similarity:98.6}]};
    throw Error(name);
  });
  await t.test('requires explicit consent before contacting AWS',async()=>{reset();await assert.rejects(createLiveness('alice','token',false),/Autorice/);assert.equal(calls.length,0);});
  await t.test('binds owner without storing credentials',async()=>{reset();await createLiveness('alice','token',true);assert.ok(!JSON.stringify([...sessions.values()]).includes('test-secret'));assert.equal(sessions.get(sid)?.owner,'alice');});
  await t.test('rejects another user',async()=>{reset();await assert.rejects(livenessResult('bob',sid),/su usuario/);assert.equal(calls.length,0);});
  await t.test('rejects expired session',async()=>{reset();sessions.get(sid)!.expiresAt=0;await assert.rejects(livenessResult('alice',sid),/venció/);assert.equal(calls.length,0);});
  await t.test('pending capture does not search faces',async()=>{reset();state='IN_PROGRESS';assert.equal((await livenessResult('alice',sid)).data.stage,'PENDING');assert.ok(!calls.includes('SearchFacesByImageCommand'));});
  await t.test('low confidence never triggers recognition',async()=>{reset();confidence=89;assert.equal((await livenessResult('alice',sid)).data.livenessPassed,false);assert.ok(!calls.includes('SearchFacesByImageCommand'));});
  await t.test('failed status cannot pass with high confidence',async()=>{reset();state='FAILED';assert.equal((await livenessResult('alice',sid)).data.livenessPassed,false);});
  await t.test('searches verified reference and caches summary only',async()=>{reset();const r=await livenessResult('alice',sid);assert.equal(r.data.livenessPassed,true);assert.equal(r.recognized,true);const count=calls.length;await livenessResult('alice',sid);assert.equal(calls.length,count);assert.ok(!JSON.stringify([...sessions.values()]).includes('Bytes'));});
  await t.test('public handler rejects direct photo bypass',async()=>{reset();const event={headers:{Authorization:'token'},body:JSON.stringify({imageBase64:'fake'}),requestContext:{requestId:'test',authorizer:{claims:{sub:'alice'}}}} as unknown as APIGatewayProxyEvent;const result=await handler(event);assert.equal(result.statusCode,400);assert.equal(JSON.parse(result.body).code,'LIVENESS_REQUIRED');assert.equal(calls.length,0);});
  mock.restoreAll();
});
