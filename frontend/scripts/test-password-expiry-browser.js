/* global process */
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer,transformWithOxc} from 'vite';
import * as cryptoV2 from '../src/services/vaultCryptoV2.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const A='SYNTHETIC_EXPIRY_OLD_SECRET',B='SYNTHETIC_EXPIRY_NEW_SECRET',login='SYNTHETIC_LOGIN_ONLY';
let identity=await cryptoV2.createIndependentIdentity('00000000-0000-4000-8000-000000000091',A);
const original=structuredClone(identity),policy={login_min_length:12,login_rotation_months:12,vault_min_length:20,vault_rotation_months:6};
const user={id:identity.userId,name:'Fictício',email:'expiry@example.invalid',role:'user',is_super_admin:false,mfa_enabled:false,must_change_password:false,vault_secret_change_required:true,crypto_identity:identity};
const fixture=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MemoryRouter,Routes,Route}from'react-router-dom';import{ThemeProvider}from'/src/context/ThemeContext.jsx';import{AuthProvider,useAuth}from'/src/context/AuthContext.jsx';import DashboardLayout from'/src/layouts/DashboardLayout.jsx';import api from'/src/services/api.js';import'/src/index.css';api.defaults.baseURL='/api';window.__syntheticUnlock=${JSON.stringify(A)};function Probe(){const auth=useAuth();const[message,setMessage]=useState('');return <section><button onClick={async()=>setMessage((await auth.unlockVault(window.__syntheticUnlock)).success?'UNLOCKED':'BLOCKED')}>Desbloquear teste</button><output>{message}</output><p>{auth.isVaultUnlocked?'KEYS_PRESENT':'KEYS_ABSENT'}</p></section>;}createRoot(document.getElementById('root')).render(<MemoryRouter><ThemeProvider><AuthProvider><Routes><Route element={<DashboardLayout/>}><Route path="*" element={<Probe/>}/></Route></Routes></AuthProvider></ThemeProvider></MemoryRouter>);`;
const vite=await createServer({root,server:{host:'127.0.0.1',port:0},appType:'custom',plugins:[{
  name:'isolated-password-expiry',resolveId(id){if(id==='virtual:expiry')return '\0expiry.jsx';},load(id){if(id==='\0expiry.jsx')return fixture;},transform(code,id){if(id==='\0expiry.jsx')return transformWithOxc(code,'expiry.jsx');},
  configureServer(server){server.middlewares.use('/__expiry',async(_req,res,next)=>{try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__expiry','<html lang="pt-BR"><head><title>Expiração — teste isolado</title></head><body><div id="root"></div><script type="module">import "virtual:expiry";</script></body></html>'));}catch(e){next(e);}});}
}]});
let browser;
try{
  await vite.listen();browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  const context=await browser.newContext(),page=await context.newPage(),origin='http://127.0.0.1:'+vite.httpServer.address().port;
  const errors=[],messages=[],writes=[];let identityReads=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>messages.push(m.text()));
  await context.addCookies([{name:'fp_csrf',value:'SYNTHETIC_CSRF',url:origin}]);
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'external access blocked');
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(request.method()==='GET'){
      if(url.pathname==='/api/auth/me')return route.fulfill({json:{user:{...user,crypto_identity:identity,password_policy:policy}}});
      if(url.pathname==='/api/auth/password-policy')return route.fulfill({json:policy});
      if(url.pathname==='/api/system/screen-protection')return route.fulfill({json:{enabled:false}});
      if(url.pathname==='/api/crypto/identity'){identityReads++;return route.fulfill({json:{identity}});}
    }
    const data=request.postDataJSON();writes.push({path:url.pathname,data});
    assert.equal(request.headers()['x-csrf-token'],'SYNTHETIC_CSRF');
    if(url.pathname==='/api/auth/reauth')return route.fulfill({json:{token:'SYNTHETIC_GRANT'}});
    if(url.pathname==='/api/crypto/identity/unlock-secret'){
      identity={...identity,kdf:data.kdf,salt:data.salt,wrappedMasterKey:data.wrappedMasterKey};user.vault_secret_change_required=false;
      return route.fulfill({json:{identity}});
    }
    throw new Error('Unexpected fixture endpoint '+url.pathname);
  });
  await page.goto(origin+'/__expiry');await page.getByText('Sua senha dos cofres expirou. Altere-a para continuar usando os cofres.').waitFor();
  await page.getByRole('button',{name:'Desbloquear teste'}).click();await page.getByText('BLOCKED',{exact:true}).waitFor();
  assert.equal(identityReads,0,'expired unlock must stop before retrieving/deriving keys');assert.equal(await page.getByText('KEYS_PRESENT',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Alterar senha dos cofres',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Alterar senha dos cofres'});
  await dialog.getByLabel('Senha atual dos cofres',{exact:true}).fill(A);await dialog.getByLabel('Nova senha dos cofres',{exact:true}).fill(B);
  await dialog.getByLabel('Confirmar nova senha',{exact:true}).fill(B);await dialog.getByLabel('Senha atual do perfil',{exact:true}).fill(login);
  await dialog.getByRole('button',{name:'Alterar senha',exact:true}).click();
  await page.getByText('Senha dos cofres alterada com sucesso. Desbloqueie seus cofres usando a nova senha.').waitFor();
  assert.equal(await page.getByText('KEYS_PRESENT',{exact:true}).count(),0,'successful change must not auto-unlock');
  for(const secret of [A,B]){assert(!JSON.stringify(writes).includes(secret));assert(!messages.some(message=>message.includes(secret)));}
  for(const field of ['publicKey','fingerprint','encryptedPrivateKey'])assert.deepEqual(identity[field],original[field]);
  await page.evaluate(secret=>{window.__syntheticUnlock=secret;},B);
  await page.getByRole('button',{name:'Desbloquear teste'}).click();await page.getByText('UNLOCKED',{exact:true}).waitFor();
  user.must_change_password=true;await page.reload();
  const forced=page.getByRole('dialog',{name:'Alterar senha do perfil'});await forced.waitFor();
  assert.equal(await forced.getByRole('button',{name:'Cancelar',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS real AuthProvider/Dashboard: expired vault blocked before keys, existing rewrap dialog, locked after success, new unlock, forced login dialog, no vault secrets in requests/logs.');
}finally{await browser?.close();await vite.close();}
