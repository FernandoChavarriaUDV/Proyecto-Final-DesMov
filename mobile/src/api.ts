import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { APP_CONFIG } from './app-config';
export interface Config { region: string; clientId: string; registerUrl: string; recognizeUrl: string; deleteUrl: string; }
export interface Registry { userId: string; name: string; status: string; faceId?: string; createdAt: string; }
export interface Result { success: boolean; message: string; recognized?: boolean; timestamp: string; data: { userId?: string; name?: string; similarity?: number; threshold?: number; faceId?: string; items?: Registry[]; nextCursor?: string; stage?:string; livenessPassed?:boolean; livenessConfidence?:number; }; }
@Injectable({providedIn:'root'})
export class Api {
  private http = inject(HttpClient);
  readonly config: Readonly<Config> = APP_CONFIG;
  token = ''; expiry = 0;
  loggedIn = signal(false); admin = signal(false);
  async login(email: string, password: string) {
    if (!this.config.clientId) throw Error('Primero configure los recursos del nuevo stack.');
    const result = await firstValueFrom(this.http.post<{AuthenticationResult?:{IdToken:string;ExpiresIn:number};ChallengeName?:string}>(`https://cognito-idp.${this.config.region}.amazonaws.com/`, { AuthFlow:'USER_PASSWORD_AUTH', ClientId:this.config.clientId, AuthParameters:{USERNAME:email,PASSWORD:password} },{headers:{'Content-Type':'application/x-amz-json-1.1','X-Amz-Target':'AWSCognitoIdentityProviderService.InitiateAuth'}}).pipe(timeout(20000)));
    if (!result.AuthenticationResult) throw Error('La cuenta requiere completar un desafío. Configure la contraseña definitiva en Cognito antes de usar esta versión.');
    this.token=result.AuthenticationResult.IdToken; this.expiry=Date.now()+result.AuthenticationResult.ExpiresIn*1000;
    const payload=JSON.parse(atob(this.token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    this.admin.set((payload['cognito:groups']??[]).includes('ADMIN')); this.loggedIn.set(true);
    // UI role display only; backend and API Gateway independently enforce authorization.
  }
  logout() { this.token='';this.expiry=0;this.loggedIn.set(false);this.admin.set(false); }
  async request(kind: 'register'|'recognize'|'delete', body?: unknown, cursor?: string):Promise<Result> {
    if (!this.token || Date.now()>=this.expiry) {this.logout();throw Error('La sesión venció. Inicie sesión nuevamente.');}
    const url=this.config[`${kind}Url`]; if(!url)throw Error('Configure las URLs AWS.');
    const options={headers:{Authorization:this.token}};
    try { const request=body===undefined?this.http.get<Result>(url+(cursor?'?cursor='+encodeURIComponent(cursor):''),options):this.http.post<Result>(url,body,options); return await firstValueFrom(request.pipe(timeout(35000))); }
    catch(e){if(e instanceof HttpErrorResponse && e.status===401)this.logout();throw e;}
  }
}
export function message(error:unknown):string {
  if(error instanceof HttpErrorResponse) return error.status===0?'No se pudo conectar. Revise Internet y las URLs.':error.error?.message??'La operación no pudo completarse.';
  return error instanceof Error?error.message:'Ocurrió un error. Intente nuevamente.';
}
