import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand, ScanCommand, type ScanCommandOutput } from '@aws-sdk/lib-dynamodb';
import { RekognitionClient, DetectFacesCommand, IndexFacesCommand, SearchFacesByImageCommand, DeleteFacesCommand, ListFacesCommand } from '@aws-sdk/client-rekognition';
import { ApiError } from './http.js';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const rk = new RekognitionClient({ maxAttempts: 2 });
const TableName = process.env.TABLE_NAME!;
const CollectionId = process.env.COLLECTION_ID!;
type RecordItem = { userId: string; name: string; externalId: string; faceId?: string; status: string; createdAt: string; consentAt: string };
async function get(userId: string) { return (await db.send(new GetCommand({ TableName, Key: { userId }, ConsistentRead: true }))).Item as RecordItem | undefined; }

export async function oneFace(bytes: Buffer) {
  const result = await rk.send(new DetectFacesCommand({ Image: { Bytes: bytes }, Attributes: ['DEFAULT'] }));
  if (result.FaceDetails?.length !== 1) throw new ApiError(422, 'EXACTLY_ONE_FACE', 'La fotografía debe contener exactamente un rostro detectable.');
}

export async function register(userId: string, name: string, bytes: Buffer, actor: string) {
  await oneFace(bytes);
  const now = new Date().toISOString();
  const item: RecordItem = { userId, name, externalId: randomUUID(), status: 'REGISTERING', createdAt: now, consentAt: now };
  try { await db.send(new PutCommand({ TableName, Item: { ...item, consentBy: actor }, ConditionExpression: 'attribute_not_exists(userId)' })); }
  catch (e) { if ((e as Error).name === 'ConditionalCheckFailedException') throw new ApiError(409, 'DUPLICATE_USER', 'El identificador ya está registrado o tiene una operación pendiente.'); throw e; }
  // Persist reservation BEFORE indexing. If AWS succeeds but persistence fails, the externalId
  // remains available for administrative recovery through delete after the execution window.
  const indexed = await rk.send(new IndexFacesCommand({ CollectionId, Image: { Bytes: bytes }, ExternalImageId: item.externalId, MaxFaces: 1, QualityFilter: 'AUTO', DetectionAttributes: ['DEFAULT'] }));
  const faceId = indexed.FaceRecords?.[0]?.Face?.FaceId;
  if (!faceId) {
    await db.send(new DeleteCommand({ TableName, Key: { userId }, ConditionExpression: 'externalId = :id', ExpressionAttributeValues: { ':id': item.externalId } }));
    throw new ApiError(422, 'LOW_QUALITY', 'La calidad de la foto no permite registrar el rostro.');
  }
  await db.send(new UpdateCommand({ TableName, Key: { userId }, UpdateExpression: 'SET faceId = :face, #s = :state', ConditionExpression: 'externalId = :id AND #s = :pending', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':face': faceId, ':state': 'REGISTERED', ':id': item.externalId, ':pending': 'REGISTERING' } }));
  return { userId, faceId, status: 'REGISTERED' };
}

export async function recognize(bytes: Buffer, requestedThreshold: unknown) {
  const threshold = Number(process.env.SIMILARITY_THRESHOLD ?? 95);
  if (!Number.isFinite(threshold) || threshold < 80 || threshold > 100) throw Error('Invalid server threshold');
  // Clients may ask for a stricter threshold, never weaken the server minimum.
  const effective = requestedThreshold === undefined ? threshold : requestedThreshold;
  if (typeof effective !== 'number' || !Number.isFinite(effective) || effective < threshold || effective > 100) throw new ApiError(400, 'INVALID_THRESHOLD', `El umbral debe estar entre ${threshold} y 100.`);
  await oneFace(bytes);
  const result = await rk.send(new SearchFacesByImageCommand({ CollectionId, Image: { Bytes: bytes }, FaceMatchThreshold: effective, MaxFaces: 1 }));
  const match = result.FaceMatches?.[0];
  if (!match?.Face?.FaceId || !match.Face.ExternalImageId) return { recognized: false, message: 'Rostro no reconocido', data: { threshold: effective } };
  // Resolve through a consistent table scan: small academic dataset; no eventually consistent
  // GSI during deletion. Pagination prevents a silent partial lookup above DynamoDB's 1 MB page.
  let cursor;
  do {
    const page: ScanCommandOutput = await db.send(new ScanCommand({ TableName, ConsistentRead: true, ExclusiveStartKey: cursor, FilterExpression: 'externalId = :id', ExpressionAttributeValues: { ':id': match.Face.ExternalImageId } }));
    const item = page.Items?.[0] as RecordItem | undefined;
    if (item?.status === 'REGISTERED' && item.faceId === match.Face.FaceId) return { recognized: true, message: 'Coincidencia encontrada', data: { userId: item.userId, name: item.name, faceId: item.faceId, similarity: match.Similarity, threshold: effective } };
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  throw new ApiError(409, 'REGISTRY_IN_PROGRESS', 'El registro está cambiando. Repita la consulta.');
}

export async function list(cursorText?: string) {
  let cursor;
  if (cursorText) {
    try { cursor = JSON.parse(Buffer.from(cursorText, 'base64url').toString('utf8')); if (typeof cursor.userId !== 'string' || Object.keys(cursor).length !== 1) throw Error(); }
    catch { throw new ApiError(400, 'INVALID_CURSOR', 'Paginación inválida.'); }
  }
  const page = await db.send(new ScanCommand({ TableName, Limit: 30, ExclusiveStartKey: cursor, ConsistentRead: true, ProjectionExpression: 'userId, #n, #s, createdAt, faceId', ExpressionAttributeNames: { '#n': 'name', '#s': 'status' } }));
  return { items: page.Items ?? [], nextCursor: page.LastEvaluatedKey ? Buffer.from(JSON.stringify(page.LastEvaluatedKey)).toString('base64url') : null };
}

export async function remove(userId: string) {
  const item = await get(userId);
  if (!item) return { userId, deleted: true, alreadyAbsent: true };
  if (item.status === 'REGISTERING' && Date.now() - Date.parse(item.createdAt) < 120_000) throw new ApiError(409, 'REGISTRATION_RUNNING', 'Espere dos minutos antes de recuperar un registro pendiente.');
  await db.send(new UpdateCommand({ TableName, Key: { userId }, UpdateExpression: 'SET #s = :state', ConditionExpression: 'externalId = :id', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':state': 'DELETING', ':id': item.externalId } }));
  const ids = new Set<string>();
  {
    let NextToken: string | undefined;
    do { const page = await rk.send(new ListFacesCommand({ CollectionId, NextToken, MaxResults: 100 })); for (const face of page.Faces ?? []) if (face.ExternalImageId === item.externalId && face.FaceId) ids.add(face.FaceId); NextToken = page.NextToken; } while (NextToken);
  }
  if (ids.size) {
    const deleted = await rk.send(new DeleteFacesCommand({ CollectionId, FaceIds: [...ids] }));
    if (deleted.UnsuccessfulFaceDeletions?.length) throw new ApiError(503, 'DELETE_PARTIAL', 'El borrado quedó pendiente. Repita la misma solicitud para completar la operación.');
  }
  // Keep DELETING metadata when Rekognition fails. Retrying is safe and never reports success early.
  await db.send(new DeleteCommand({ TableName, Key: { userId }, ConditionExpression: 'externalId = :id', ExpressionAttributeValues: { ':id': item.externalId } }));
  return { userId, deleted: true };
}
