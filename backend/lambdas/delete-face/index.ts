import { authorize, endpoint, parse, userId } from '../../shared/http.js';
import { remove } from '../../shared/service.js';
export const handler = endpoint(async event => { authorize(event, true); return { message: 'Registro facial eliminado correctamente', data: await remove(userId(parse(event).userId)) }; });
