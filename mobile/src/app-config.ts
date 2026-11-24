import type { Config } from './api';
// Public deployment identifiers only. Passwords and tokens are never bundled.
export const APP_CONFIG: Readonly<Config> = Object.freeze({
  region: 'us-east-1',
  clientId: 'h0m1qlk8gk5cr2khao4b2aref',
  registerUrl: 'https://l9107atn0i.execute-api.us-east-1.amazonaws.com/v1/register',
  recognizeUrl: 'https://l9107atn0i.execute-api.us-east-1.amazonaws.com/v1/recognize',
  deleteUrl: 'https://l9107atn0i.execute-api.us-east-1.amazonaws.com/v1/delete'
});
