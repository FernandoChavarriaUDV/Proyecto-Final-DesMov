import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { authorize, image, parse, userId, endpoint, ApiError } from '../backend/shared/http.js';
const event = (claims?: Record<string,string>) => ({ body: '{}', requestContext: { requestId: 'test', authorizer: claims ? { claims } : undefined } }) as unknown as APIGatewayProxyEvent;
test('requires authenticated principal and admin claim', () => {
  assert.throws(() => authorize(event()), /Inicie/);
  assert.throws(() => authorize(event({ sub: 'u' }), true), /administrador/);
  assert.equal(authorize(event({ sub: 'u', 'cognito:groups': '[ADMIN,OTHER]' }), true), 'u');
});
test('validates identifiers and rejects malformed JSON', () => { assert.equal(userId('USR001'), 'USR001'); assert.throws(() => userId('../')); assert.throws(() => parse({ ...event(), body: '[' })); });
test('rejects nonimages, prefixed data and oversized payloads', () => { for (const value of ['', 'hello', 'data:image/jpeg;base64,/9j/', 'A'.repeat(2_000_004)]) assert.throws(() => image(value)); });
test('returns controlled errors without leaking internals', async () => {
  const result = await endpoint(async () => { throw new ApiError(403, 'FORBIDDEN', 'Operación no permitida'); })(event());
  assert.equal(result.statusCode, 403); assert.equal(JSON.parse(result.body).success, false); assert.ok(JSON.parse(result.body).timestamp);
});
