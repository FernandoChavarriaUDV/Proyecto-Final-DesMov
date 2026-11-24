import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
export class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export function parse(event: APIGatewayProxyEvent): Record<string, unknown> {
  if (!event.body || event.isBase64Encoded) throw new ApiError(400, 'INVALID_BODY', 'Se requiere JSON.');
  if (Buffer.byteLength(event.body) > 2_100_000) throw new ApiError(413, 'IMAGE_TOO_LARGE', 'La imagen supera el límite.');
  try { const value = JSON.parse(event.body); if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(); return value; }
  catch { throw new ApiError(400, 'INVALID_JSON', 'El cuerpo JSON es inválido.'); }
}
export function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ApiError(400, 'INVALID_FIELD', `Revise ${field}.`);
  return value.trim();
}
export function userId(value: unknown): string {
  const id = text(value, 'userId', 64);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new ApiError(400, 'INVALID_ID', 'Use letras, números, guion o guion bajo.');
  return id;
}
export function image(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length > 2_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new ApiError(400, 'INVALID_IMAGE', 'Envíe una imagen Base64 válida sin prefijo data.');
  const bytes = Buffer.from(value, 'base64');
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (!bytes.length || bytes.length > 1_500_000 || (!jpeg && !png)) throw new ApiError(400, 'INVALID_IMAGE', 'Use JPEG o PNG de hasta 1,5 MB.');
  return bytes;
}
export function authorize(event: APIGatewayProxyEvent, admin = false): string {
  const claims = event.requestContext.authorizer?.claims;
  if (!claims?.sub) throw new ApiError(401, 'UNAUTHORIZED', 'Inicie sesión.');
  const groups = String(claims['cognito:groups'] ?? '').replace(/[\[\]" ]/g, '').split(',');
  if (admin && !groups.includes('ADMIN')) throw new ApiError(403, 'FORBIDDEN', 'Se requiere el rol administrador.');
  return String(claims.sub);
}
export function endpoint(action: (event: APIGatewayProxyEvent) => Promise<Record<string, unknown>>) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const timestamp = new Date().toISOString();
    try { const result = await action(event); return response(200, { success: true, ...result, timestamp }); }
    catch (error) {
      if (error instanceof Error && ['InvalidImageFormatException','ImageTooLargeException','InvalidParameterException'].includes(error.name)) {
        return response(422, { success: false, code: 'IMAGE_REJECTED', message: 'AWS no pudo procesar la imagen. Capture otra fotografía JPEG o PNG con un solo rostro.', timestamp });
      }
      const known = error instanceof ApiError;
      // Never log request bodies, names, tokens or biometric data.
      if (!known) console.error(JSON.stringify({ requestId: event.requestContext.requestId, error: error instanceof Error ? error.name : 'UnknownError' }));
      return response(known ? error.status : 503, { success: false, code: known ? error.code : 'SERVICE_UNAVAILABLE', message: known ? error.message : 'El servicio no pudo completar la operación. Intente más tarde.', timestamp });
    }
  };
}
function response(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://localhost' }, body: JSON.stringify(body) };
}
