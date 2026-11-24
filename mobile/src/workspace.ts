import { Component, inject, DestroyRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonApp, IonRouterOutlet, IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonCard, IonCardContent, IonInput, IonCheckbox, IonSpinner, IonIcon, AlertController } from '@ionic/angular';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { addIcons } from 'ionicons';
import { scanOutline, personAddOutline, shieldCheckmarkOutline, cameraOutline, arrowBackOutline, trashOutline, arrowForwardOutline, logOutOutline, lockClosedOutline, eyeOutline, eyeOffOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { Api, Registry, Result, message } from './api';
import { captureLiveness, LivenessSession } from './liveness';
@Component({selector:'app-root',standalone:true,imports:[IonApp,IonRouterOutlet],template:'<ion-app><ion-router-outlet /></ion-app>'})
export class AppComponent {}
@Component({standalone:true, imports:[CommonModule,ReactiveFormsModule,RouterLink,IonHeader,IonToolbar,IonTitle,IonContent,IonButton,IonCard,IonCardContent,IonInput,IonCheckbox,IonSpinner,IonIcon], templateUrl:'./workspace.html'})
export class WorkspaceComponent {
  api=inject(Api); private fb=inject(FormBuilder);private route=inject(ActivatedRoute);
  private alerts=inject(AlertController); showPassword=signal(false);
  screen=signal('home'); busy=signal(false); error=signal(''); notice=signal(''); photo=signal(''); result=signal<Result|null>(null); records=signal<Registry[]>([]); cursor=signal<string|undefined>(undefined);
  loginForm=this.fb.nonNullable.group({email:['',[Validators.required,Validators.email]],password:['',Validators.required]});
  registerForm=this.fb.nonNullable.group({userId:['',[Validators.required,Validators.pattern(/^[A-Za-z0-9_-]{1,64}$/)]],name:['',[Validators.required,Validators.maxLength(120)]],consent:[false,Validators.requiredTrue]});
  recognitionConsent=false; hasLoaded=signal(false);
  constructor(){addIcons({scanOutline,personAddOutline,shieldCheckmarkOutline,cameraOutline,arrowBackOutline,trashOutline,arrowForwardOutline,logOutOutline,lockClosedOutline,eyeOutline,eyeOffOutline,checkmarkCircleOutline}); this.route.data.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(p=>{this.screen.set(p['screen']??'home');this.photo.set('');this.result.set(null);this.error.set('');this.notice.set('');this.recognitionConsent=false;});}
  async run(action:()=>Promise<void>){if(this.busy())return;this.busy.set(true);this.error.set('');this.notice.set('');try{await action();}catch(e){this.notice.set('');this.error.set(message(e));}finally{this.busy.set(false);}}
  login(){this.loginForm.markAllAsTouched();if(this.loginForm.invalid)return;void this.run(async()=>{const v=this.loginForm.getRawValue();await this.api.login(v.email,v.password);this.loginForm.controls.password.reset();this.notice.set('Sesión iniciada. Ya puede utilizar los servicios.');});}
  capture(){void this.run(async()=>{const p=await Camera.getPhoto({source:CameraSource.Camera,resultType:CameraResultType.Base64,quality:80,width:1024,height:1024,correctOrientation:true,saveToGallery:false});if(!p.base64String)throw Error('No se recibió una fotografía.');if(p.base64String.length>2_000_000)throw Error('La foto es demasiado grande. Repita la captura.');this.photo.set(p.base64String);this.result.set(null);});}
  register(){this.registerForm.markAllAsTouched();if(this.registerForm.invalid||!this.photo())return;void this.run(async()=>{this.result.set(await this.api.request('register',{...this.registerForm.getRawValue(),imageBase64:this.photo()}));this.photo.set('');this.registerForm.reset();});}
  recognize(){if(!this.recognitionConsent)return;void this.run(async()=>{
    this.result.set(null);this.notice.set('Preparando prueba de vida…');
    const created=await this.api.request('recognize',{action:'createSession',consent:true});
    let session=created.data as unknown as LivenessSession;
    try {await captureLiveness(session);}finally{session.credentials={accessKeyId:'',secretAccessKey:'',sessionToken:'',expiresAt:0};}
    this.notice.set('Consultando presencia real y coincidencia…');
    for(let attempt=0;attempt<30;attempt++){
      const outcome=await this.api.request('recognize',{action:'getResult',sessionId:session.sessionId});
      if(outcome.data.stage==='COMPLETE'){this.result.set(outcome);this.notice.set('');return;}
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    throw Error('AWS no terminó a tiempo. Espere e inicie una nueva prueba.');
  });}
  load(more=false){void this.run(async()=>{const r=await this.api.request('register',undefined,more?this.cursor():undefined);this.records.set(more?[...this.records(),...(r.data.items??[])]:r.data.items??[]);this.cursor.set(r.data.nextCursor??undefined);this.hasLoaded.set(true);});}
  async remove(item:Registry){if(this.busy())return;const alert=await this.alerts.create({header:'¿Eliminar este rostro?',subHeader:item.name,message:'Se eliminará su referencia facial. Esta acción no se puede deshacer.',buttons:[{text:'Cancelar',role:'cancel'},{text:'Eliminar',role:'confirm',cssClass:'delete-confirm'}]});await alert.present();if((await alert.onDidDismiss()).role!=='confirm')return;void this.run(async()=>{const r=await this.api.request('delete',{userId:item.userId});this.records.update(items=>items.filter(i=>i.userId!==item.userId));this.notice.set(r.message);});}
}
