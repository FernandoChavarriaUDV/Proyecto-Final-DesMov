import { authorize, endpoint, parse, ApiError } from '../../shared/http.js';
import { createLiveness, livenessResult } from '../../shared/liveness.js';
export const handler = endpoint(async event => {
  const owner=authorize(event);const body=parse(event);
  if(body.action==='createSession')return createLiveness(owner,(event.headers.Authorization??event.headers.authorization??'').replace(/^Bearer\s+/i,''),body.consent);
  if(body.action==='getResult')return livenessResult(owner,body.sessionId);
  throw new ApiError(400,'LIVENESS_REQUIRED','El reconocimiento requiere una sesión de prueba de vida. Use createSession y getResult; no envíe una fotografía directa.');
});
