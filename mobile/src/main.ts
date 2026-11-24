import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideIonicAngular } from '@ionic/angular';
import { AppComponent, WorkspaceComponent } from './workspace';
bootstrapApplication(AppComponent, { providers: [provideIonicAngular({ mode: 'md' }), provideHttpClient(), provideRouter([
  { path: 'home', component: WorkspaceComponent, data: {screen:'home'} },
  { path: 'register', component: WorkspaceComponent, data: {screen:'register'} },
  { path: 'recognize', component: WorkspaceComponent, data: {screen:'recognize'} },
  { path: 'admin', component: WorkspaceComponent, data: {screen:'admin'} },
  { path: '**', redirectTo: 'home' }
])] }).catch(console.error);
