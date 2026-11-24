import { Capacitor, registerPlugin } from '@capacitor/core';
export interface LivenessSession {
  sessionId: string; region: string;
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiresAt: number };
}
const detector=registerPlugin<{start(options:LivenessSession):Promise<{completed:boolean}>}>('FaceLiveness');
export async function captureLiveness(session:LivenessSession) {
  if(Capacitor.getPlatform()!=='android')throw Error('La prueba de vida de esta versión requiere la app Android instalada.');
  return detector.start(session);
}
