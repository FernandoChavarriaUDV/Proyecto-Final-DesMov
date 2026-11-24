import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { RekognitionClient, CreateFaceLivenessSessionCommand, GetFaceLivenessSessionResultsCommand } from '@aws-sdk/client-rekognition';
import { CognitoIdentityClient, GetIdCommand, GetCredentialsForIdentityCommand } from '@aws-sdk/client-cognito-identity';
import { ApiError } from './http.js';
import { recognize } from './service.js';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const rk = new RekognitionClient({maxAttempts:2});
const identity = new CognitoIdentityClient({});
const table = () => process.env.SESSIONS_TABLE!;
const now = () => Math.floor(Date.now()/1000);
const conditional = (e:unknown) => e instanceof Error && e.name==='ConditionalCheckFailedException';

export async function createLiveness(owner:string, token:string, consent:unknown) {
  if(consent!==true)throw new ApiError(400,'CONSENT_REQUIRED','Autorice la prueba de vida y la comparación facial.');
  if(!process.env.IDENTITY_POOL_ID || !process.env.USER_POOL_ID || !table())throw new ApiError(503,'LIVENESS_NOT_CONFIGURED','Primero despliegue la actualización de Face Liveness en AWS.');
  const epoch=now();
  try { await db.send(new PutCommand({TableName:table(),Item:{sessionId:`RATE#${owner}`,expiresAt:epoch+30},ConditionExpression:'attribute_not_exists(sessionId) OR expiresAt <= :now',ExpressionAttributeValues:{':now':epoch}})); }
  catch(e){if(conditional(e))throw new ApiError(429,'COOLDOWN','Espere 30 segundos antes de iniciar otra prueba.');throw e;}
  const region=process.env.AWS_REGION??'us-east-1';
  const Logins = {[`cognito-idp.${region}.amazonaws.com/${process.env.USER_POOL_ID}`]:token};
  // Cognito verifies this User Pool token and grants only the authenticated streaming role.
  const id=await identity.send(new GetIdCommand({IdentityPoolId:process.env.IDENTITY_POOL_ID,Logins}));
  const auth=await identity.send(new GetCredentialsForIdentityCommand({IdentityId:id.IdentityId,Logins}));
  const credentials=auth.Credentials;
  if(!credentials?.AccessKeyId || !credentials.SecretKey || !credentials.SessionToken)throw Error('Temporary credentials unavailable');
  const session=await rk.send(new CreateFaceLivenessSessionCommand({ClientRequestToken:randomUUID(),Settings:{AuditImagesLimit:0}}));
  if(!session.SessionId)throw Error('Session unavailable');
  await db.send(new PutCommand({TableName:table(),Item:{sessionId:session.SessionId,owner,status:'CREATED',expiresAt:epoch+180},ConditionExpression:'attribute_not_exists(sessionId)'}));
  return {message:'Sesión de prueba de vida creada',data:{stage:'CAPTURE',sessionId:session.SessionId,region,expiresAt:epoch+180,
    credentials:{accessKeyId:credentials.AccessKeyId,secretAccessKey:credentials.SecretKey,sessionToken:credentials.SessionToken,expiresAt:credentials.Expiration?.getTime()}}};
}

export async function livenessResult(owner:string,sessionId:unknown) {
  if(typeof sessionId!=='string'||!/^[a-f0-9-]{36}$/i.test(sessionId))throw new ApiError(400,'INVALID_SESSION','La sesión es inválida.');
  const item=(await db.send(new GetCommand({TableName:table(),Key:{sessionId},ConsistentRead:true}))).Item;
  if(!item || item.owner!==owner)throw new ApiError(404,'SESSION_NOT_FOUND','No se encontró una sesión de su usuario.');
  if(item.expiresAt<=now())throw new ApiError(410,'SESSION_EXPIRED','La sesión venció. Inicie una nueva prueba.');
  if(item.outcome)return item.outcome;
  const session=await rk.send(new GetFaceLivenessSessionResultsCommand({SessionId:sessionId}));
  if(['CREATED','IN_PROGRESS'].includes(session.Status??''))return {message:'AWS está procesando la prueba de vida',data:{stage:'PENDING'}};
  const confidence=session.Confidence??0;
  const livenessPassed=session.Status==='SUCCEEDED' && confidence>=Number(process.env.LIVENESS_THRESHOLD??90);
  const lease=randomUUID();
  try { await db.send(new UpdateCommand({TableName:table(),Key:{sessionId},UpdateExpression:'SET #s=:processing, leaseId=:lease, leaseUntil=:until',ConditionExpression:'attribute_not_exists(outcome) AND (#s=:created OR leaseUntil < :now)',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':processing':'PROCESSING',':created':'CREATED',':lease':lease,':until':now()+40,':now':now()}})); }
  catch(e){if(conditional(e))return {message:'La consulta sigue en proceso',data:{stage:'PENDING'}};throw e;}
  try {
    let outcome:Record<string,unknown>;
    if(!livenessPassed)outcome={recognized:false,message:'Prueba de vida no aprobada. No se realizó reconocimiento.',data:{stage:'COMPLETE',livenessPassed:false,livenessConfidence:confidence}};
    else {
      const reference=session.ReferenceImage?.Bytes;
      if(!reference?.length)throw new ApiError(503,'NO_REFERENCE','AWS no devolvió una selfie utilizable. Repita la prueba.');
      const match=await recognize(Buffer.from(reference),undefined);
      outcome={...match,message:match.recognized?'Prueba de vida aprobada. Coincidencia encontrada.':'Prueba de vida aprobada. Rostro no reconocido.',data:{...match.data,stage:'COMPLETE',livenessPassed:true,livenessConfidence:confidence}};
    }
    // Store only the summary. Neither reference bytes nor temporary credentials are persisted.
    await db.send(new UpdateCommand({TableName:table(),Key:{sessionId},UpdateExpression:'SET outcome=:outcome, #s=:complete REMOVE leaseId, leaseUntil',ConditionExpression:'leaseId=:lease',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':outcome':outcome,':complete':'COMPLETE',':lease':lease}}));
    return outcome;
  }catch(e){
    await db.send(new UpdateCommand({TableName:table(),Key:{sessionId},UpdateExpression:'SET #s=:created REMOVE leaseId, leaseUntil',ConditionExpression:'leaseId=:lease',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':created':'CREATED',':lease':lease}})).catch(()=>{});
    throw e;
  }
}
