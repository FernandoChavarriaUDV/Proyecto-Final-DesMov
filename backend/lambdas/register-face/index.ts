import { authorize, endpoint, parse, image, userId, text, ApiError } from '../../shared/http.js';
import { register, list } from '../../shared/service.js';
export const handler = endpoint(async event => {
  const actor = authorize(event, true);
  if (event.httpMethod === 'GET') return { message: 'Registros consultados', data: await list(event.queryStringParameters?.['cursor']) };
  const body = parse(event);
  if (body.consent !== true) throw new ApiError(400, 'CONSENT_REQUIRED', 'Se requiere consentimiento explícito de la persona fotografiada.');
  return { message: 'Rostro registrado correctamente', data: await register(userId(body.userId), text(body.name, 'name', 120), image(body.imageBase64), actor) };
});
