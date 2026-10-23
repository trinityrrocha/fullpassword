/* global process */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer,transformWithOxc} from 'vite';
import {createIndependentIdentity} from '../src/services/vaultCryptoV2.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=process.env.PROFILE_UI_EVIDENCE_DIR;
if(output)fs.mkdirSync(output,{recursive:true});
const A='SYNTHETIC_BROWSER_OLD_VAULT',B='SYNTHETIC_BROWSER_NEW_VAULT',login='SYNTHETIC_BROWSER_LOGIN';
let identity=await createIndependentIdentity('00000000-0000-4000-8000-000000000001',A);
const user={id:identity.userId,name:'Pessoa fictícia',email:'synthetic@example.invalid',role:'admin',is_super_admin:true,mfa_enabled:true,crypto_identity:identity};
const fixture=`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{AuthContext}from'/src/context/AuthContext.jsx';
import UserProfileModal from'/src/components/UserProfileModal.jsx';import TeamList from'/src/pages/TeamList.jsx';import ReauthDialog from'/src/components/ReauthDialog.jsx';
import SecurityCard from'/src/components/SecurityCard.jsx';
import api from'/src/services/api.js';import'/src/index.css';api.defaults.baseURL='/api';
function Fixture(){const[open,setOpen]=useState(false),[forced,setForced]=useState(false);const cleanups=new Set();
const value={user:${JSON.stringify(user)},registerVaultLockCleanup:fn=>{cleanups.add(fn);return()=>cleanups.delete(fn);},logout:async()=>{window.__loggedOut=true;},completeIdentityUnlockChange:()=>{window.__locked=true;cleanups.forEach(fn=>fn());setOpen(false);}};
return <AuthContext.Provider value={value}><main className="p-4"><button id="open-profile" onClick={()=>{setForced(false);setOpen(true);}}>Meu Perfil</button><button id="open-forced" onClick={()=>{setForced(true);setOpen(true);}}>Forçar troca</button><SecurityCard/><TeamList/><UserProfileModal isOpen={open} onClose={()=>setOpen(false)} forcePasswordChange={forced}/><ReauthDialog/></main></AuthContext.Provider>;}createRoot(document.getElementById('root')).render(<Fixture/>);
`;
const vite=await createServer({root,server:{host:'127.0.0.1',port:0},appType:'custom',plugins:[{
  name:'profile-security-isolated-fixture',enforce:'pre',
  resolveId(id){if(id==='virtual:profile-fixture')return'\0profile-fixture.jsx';},load(id){if(id==='\0profile-fixture.jsx')return fixture;},
  transform(code,id){if(id==='\0profile-fixture.jsx')return transformWithOxc(code,'profile-fixture.jsx');if(id.replaceAll('\\','/').endsWith('/src/context/AuthContext.jsx'))return code+'\nexport {AuthContext};';},
  configureServer(server){server.middlewares.use('/__profile_fixture',async(_req,res,next)=>{try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__profile_fixture','<html lang="pt-BR"><head><title>Perfil e equipe — teste isolado</title></head><body><div id="root"></div><script type="module">import "virtual:profile-fixture";</script></body></html>'));}catch(e){next(e);}});}
}]});
let browser;
try{
  await vite.listen();browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'}),page=await context.newPage();
  const origin=`http://127.0.0.1:${vite.httpServer.address().port}`,writes=[],errors=[],consoleMessages=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>consoleMessages.push(m.text()));
  page.on('dialog',async dialog=>{errors.push('Unexpected native '+dialog.type());await dialog.dismiss();});
  await context.addCookies([{name:'fp_csrf',value:'SYNTHETIC_CSRF',url:origin}]);
  let failWrite=false,delay=0;
  let passwordPolicy={login_min_length:12,login_rotation_months:12,vault_min_length:16,vault_rotation_months:12};
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'no real installation/external service may be accessed');
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(request.method()==='GET'){
      if(url.pathname==='/api/auth/password-policy')return route.fulfill({json:passwordPolicy});
      if(url.pathname==='/api/system/client-ip-status')return route.fulfill({json:{mode:'direct',client_ip:'192.0.2.10',cloudflare:false,defined_in_deployment:true}});
      if(url.pathname==='/api/system/login-security-policy')return route.fulfill({json:{policy:{auto_block_enabled:true,failed_attempts_threshold:5,observation_window_minutes:15,block_duration_minutes:30,screen_protection_enabled:true}}});
      if(url.pathname==='/api/system/login-failures')return route.fulfill({json:{items:[],pagination:{page:1,limit:10,total_pages:0}}});
      if(url.pathname==='/api/users')return route.fulfill({json:[{id:'00000000-0000-4000-8000-000000000002',name:'Membro fictício',email:'member@example.invalid',role:'user',is_active:true,groups:[],mfa_enabled:true}]});
      if(url.pathname==='/api/groups')return route.fulfill({json:Array.from({length:8},(_,i)=>({id:'g'+i,name:'Grupo fictício '+i,can_view:true}))});
      if(url.pathname==='/api/users/profile/mfa')return route.fulfill({json:{mfa_enabled:true,recovery_codes_remaining:6}});
      if(url.pathname==='/api/auth/sessions')return route.fulfill({json:{sessions:[],pagination:{page:1,total:0,total_pages:1}}});
      if(url.pathname==='/api/crypto/identity')return route.fulfill({json:{identity}});
    }else{
      assert.equal(request.headers()['x-csrf-token'],'SYNTHETIC_CSRF');
      const data=request.postDataJSON();writes.push({path:url.pathname,data});
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      if(failWrite)return route.fulfill({status:503,json:{error:'Falha fictícia. Tente novamente.'}});
      if(url.pathname==='/api/system/password-policy'){assert.deepEqual(Object.keys(data).sort(),Object.keys(passwordPolicy).sort());passwordPolicy={...data};return route.fulfill({json:passwordPolicy});}
      if(url.pathname==='/api/auth/reauth')return route.fulfill({json:{token:'SYNTHETIC_GRANT'}});
      if(url.pathname==='/api/crypto/identity/unlock-secret'){identity={...identity,kdf:data.kdf,salt:data.salt,wrappedMasterKey:data.wrappedMasterKey};return route.fulfill({json:{identity}});}
      if(url.pathname==='/api/users/profile')return route.fulfill({json:data.email==='new@example.invalid'?{email_change_pending:true}:{session_invalidated:Boolean(data.new_password)}});
      if(url.pathname==='/api/auth/confirm-email')return route.fulfill({json:{confirmed:true}});
      if(url.pathname==='/api/users'||/^\/api\/users\//.test(url.pathname))return route.fulfill({json:{id:'synthetic-new'}});
    }
    throw new Error('Unexpected fixture endpoint '+url.pathname);
  });
  const reload=async()=>{await page.goto(origin+'/__profile_fixture');await page.getByRole('button',{name:'Novo Membro',exact:true}).waitFor();};
  const openProfile=async()=>{await page.locator('#open-profile').click();await page.getByRole('dialog',{name:'Meu Perfil',exact:true}).waitFor();};
  const screenshot=async name=>{if(output)await page.screenshot({path:path.join(output,name+'.png')});};
  const bounds=async dialog=>{
    const panel=await dialog.evaluate(node=>{const r=node.getBoundingClientRect(),overlay=node.closest('[data-form-dialog]');return{x:r.x,y:r.y,w:r.width,h:r.height,viewport:innerWidth,height:innerHeight,position:getComputedStyle(node).position,z:getComputedStyle(node).zIndex,backdropZ:getComputedStyle(overlay.querySelector('[data-dialog-backdrop]')).zIndex};});
    assert(panel.x>=0&&panel.y>=0&&panel.x+panel.w<=panel.viewport+1&&panel.y+panel.h<=panel.height+1);
    assert.equal(panel.position,'relative');assert(+panel.z>+panel.backdropZ,'panel must stack above backdrop');
    assert.equal(await dialog.evaluate(node=>node.scrollWidth>node.clientWidth),false,'no panel horizontal overflow');
    for(const control of await dialog.locator('input:not([type=radio]):not([type=hidden]):not([disabled]),select,footer button').all()){
      await control.scrollIntoViewIfNeeded();
      assert.equal(await control.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'backdrop/another layer must not intercept control');
    }
  };
  // Real SecurityCard and policy form, including native select keyboard behavior.
  await reload();
  const openSecurity=async()=>{await page.getByRole('button',{name:'Segurança',exact:true}).click();await page.getByRole('form',{name:'Política de Senhas'}).waitFor();};
  await openSecurity();
  let policyForm=page.getByRole('form',{name:'Política de Senhas'});
  const field=(kind,label)=>policyForm.getByRole('combobox',{name:kind+' — '+label});
  for(const kind of ['Senha de login','Senha dos cofres']){
    assert.deepEqual(await field(kind,'Tamanho mínimo').locator('option').evaluateAll(options=>options.map(o=>o.value)),['8','12','16','20']);
    assert.deepEqual(await field(kind,'Solicitar troca a cada').locator('option').evaluateAll(options=>options.map(o=>o.value)),['6','12','18']);
  }
  const first=field('Senha de login','Tamanho mínimo');await first.focus();await first.press('Home');await first.press('ArrowDown');await first.press('Escape');
  await field('Senha de login','Tamanho mínimo').selectOption('20');await field('Senha dos cofres','Tamanho mínimo').selectOption('12');
  await field('Senha de login','Solicitar troca a cada').selectOption('6');await field('Senha dos cofres','Solicitar troca a cada').selectOption('18');
  // Collapsing the accordion must not discard the pending draft.
  await page.getByRole('button',{name:'Segurança',exact:true}).click();await openSecurity();policyForm=page.getByRole('form',{name:'Política de Senhas'});
  assert.equal(await field('Senha de login','Tamanho mínimo').inputValue(),'20');
  failWrite=true;await policyForm.getByRole('button',{name:'Salvar política',exact:true}).click();await policyForm.getByText('Não foi possível salvar a política. Confira a conexão e tente novamente.').waitFor();
  assert.equal(await field('Senha dos cofres','Tamanho mínimo').inputValue(),'12');failWrite=false;delay=100;
  const count=writes.filter(w=>w.path==='/api/system/password-policy').length;
  await policyForm.getByRole('button',{name:'Salvar política',exact:true}).evaluate(button=>{button.click();button.click();});
  await policyForm.getByText('Política de senhas atualizada.').waitFor();delay=0;
  assert.equal(writes.filter(w=>w.path==='/api/system/password-policy').length,count+1);
  await reload();await openSecurity();policyForm=page.getByRole('form',{name:'Política de Senhas'});
  assert.equal(await field('Senha de login','Tamanho mínimo').inputValue(),'20');assert.equal(await field('Senha dos cofres','Solicitar troca a cada').inputValue(),'18');
  for(const width of [1280,390,320])for(const dark of [false,true]){
    await page.setViewportSize({width,height:900});await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);
    assert.equal(await policyForm.evaluate(node=>node.scrollWidth>node.clientWidth),false);
    for(const select of await policyForm.getByRole('combobox').all()){
      const rect=await select.boundingBox();assert.equal(Math.round(rect.height),35);assert(rect.x>=0&&rect.x+rect.width<=width+1);
    }
    await screenshot('security-policy-'+width+'-'+(dark?'dark':'light'));
    if(output)await policyForm.locator('..').screenshot({path:path.join(output,'security-policy-fields-'+width+'-'+(dark?'dark':'light')+'.png')});
  }
  assert(!fs.readFileSync(path.join(root,'src/pages/Settings.jsx'),'utf8').includes('Política Global de Senhas'));
  passwordPolicy={login_min_length:12,login_rotation_months:12,vault_min_length:16,vault_rotation_months:12};
  await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>document.documentElement.classList.remove('dark'));
  await reload();await openProfile();
  let profile=page.getByRole('dialog',{name:'Meu Perfil',exact:true});
  assert.deepEqual(await profile.locator('input').evaluateAll(inputs=>inputs.slice(0,2).map(i=>i.id)),['profile-name','profile-email']);
  assert.equal(await profile.getByLabel('E-mail',{exact:true}).getAttribute('readonly'),'');
  await profile.getByRole('button',{name:'Alterar',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Alterar e-mail',exact:true});
  await dialog.getByLabel('Novo e-mail').fill('new@example.invalid');await dialog.getByRole('button',{name:'Enviar código'}).click();
  await dialog.getByText('Enviamos um código de confirmação para o novo endereço.').waitFor();
  assert.equal(await dialog.getByLabel('Novo e-mail').inputValue(),'new@example.invalid');
  await dialog.getByLabel('Código de confirmação').fill('SYNTHETIC_CODE');
  const navigated=page.waitForURL('**/login');await dialog.getByRole('button',{name:'Confirmar alteração'}).click();await navigated;
  assert(writes.some(w=>w.path==='/api/auth/confirm-email'&&w.data.token==='SYNTHETIC_CODE'));
  await reload();await openProfile();
  await page.getByRole('button',{name:'Senha do perfil Usada para entrar no FullPassword.'}).click();
  dialog=page.getByRole('dialog',{name:'Alterar senha do perfil'});
  await dialog.getByRole('button',{name:'Alterar senha',exact:true}).click();await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.locator('input[type=password]').count(),3);
  await dialog.getByLabel('Senha atual',{exact:true}).fill(login);await dialog.getByLabel('Nova senha',{exact:true}).fill('SYNTHETIC_NEW_LOGIN_123!');await dialog.getByLabel('Confirmar nova senha',{exact:true}).fill('SYNTHETIC_NEW_LOGIN_123!');
  await dialog.getByLabel('Código MFA atual').fill('123456');
  failWrite=true;await dialog.getByRole('button',{name:'Alterar senha',exact:true}).click();await dialog.getByText('Falha fictícia. Tente novamente.').waitFor();failWrite=false;
  assert.equal(await dialog.getByLabel('Senha atual',{exact:true}).inputValue(),'','sensitive fields cleared after submit');
  await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Descartar alterações?'}).getByRole('button',{name:'Descartar',exact:true}).click();
  await page.getByRole('dialog',{name:'Meu Perfil',exact:true}).waitFor();
  await page.getByRole('button',{name:'Senha dos cofres Usada para desbloquear seus cofres.'}).click();
  dialog=page.getByRole('dialog',{name:'Alterar senha dos cofres'});
  await dialog.getByLabel('Senha atual dos cofres',{exact:true}).fill(A);await dialog.getByLabel('Nova senha dos cofres',{exact:true}).fill(B);await dialog.getByLabel('Confirmar nova senha',{exact:true}).fill(B);await dialog.getByLabel('Senha atual do perfil',{exact:true}).fill(login);await dialog.getByLabel('Código MFA atual').fill('123456');
  await dialog.getByRole('button',{name:'Alterar senha',exact:true}).click();
  await page.waitForFunction(()=>window.__locked===true);
  assert.equal(await page.locator('[role=dialog]').count(),0);assert.equal(await page.locator('#root').evaluate(n=>n.inert),false,'all nested cleanup must restore background');
  for(const secret of [A,B]){assert(!JSON.stringify(writes).includes(secret));assert(!JSON.stringify(consoleMessages).includes(secret));assert(!await page.evaluate(s=>JSON.stringify({...localStorage,...sessionStorage}).includes(s),secret));}
  await reload();await openProfile();profile=page.getByRole('dialog',{name:'Meu Perfil',exact:true});
  await profile.getByLabel('Nome',{exact:true}).fill('Pessoa fictícia alterada');await profile.getByRole('radio',{name:'Superior',exact:true}).locator('..').click();
  assert.equal(await profile.getByRole('radio',{name:'Superior',exact:true}).isChecked(),true);
  const savedReload=page.waitForEvent('load');await profile.getByRole('button',{name:'Salvar Alterações'}).click();await savedReload;
  assert(writes.some(w=>w.path==='/api/users/profile'&&w.data.name==='Pessoa fictícia alterada'&&w.data.menu_position==='top'&&w.data.email===user.email&&!w.data.new_password));
  await reload();await page.locator('#open-forced').click();dialog=page.getByRole('dialog',{name:'Alterar senha do perfil'});
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),1);assert.equal(await dialog.getByRole('button',{name:'Cancelar',exact:true}).count(),0);assert.equal(await dialog.getByLabel('Senha atual',{exact:true}).isVisible(),true);
  await dialog.getByLabel('Senha atual',{exact:true}).fill(login);await dialog.getByLabel('Nova senha',{exact:true}).fill('SYNTHETIC_NEW_LOGIN_123!');await dialog.getByLabel('Confirmar nova senha',{exact:true}).fill('SYNTHETIC_NEW_LOGIN_123!');await dialog.getByLabel('Código MFA atual').fill('123456');
  const loginNavigation=page.waitForURL('**/login');await dialog.getByRole('button',{name:'Alterar senha',exact:true}).click();await loginNavigation;
  assert(writes.some(w=>w.path==='/api/users/profile'&&w.data.new_password&&!w.data.crypto_identity&&!w.data.wrapped_key));
  for(const width of [1280,390,320])for(const dark of [false,true]){
    await page.setViewportSize({width,height:width===1280?800:850});await reload();await page.evaluate(value=>document.documentElement.classList.toggle('dark',value),dark);
    await openProfile();profile=page.getByRole('dialog',{name:'Meu Perfil',exact:true});await bounds(profile);await screenshot(`profile-${width}-${dark?'dark':'light'}`);
    for(const [trigger,title] of [['Alterar','Alterar e-mail'],['Senha do perfil Usada para entrar no FullPassword.','Alterar senha do perfil'],['Senha dos cofres Usada para desbloquear seus cofres.','Alterar senha dos cofres']]){
      await profile.getByRole('button',{name:trigger,exact:true}).click();const child=page.getByRole('dialog',{name:title,exact:true});await bounds(child);
      await child.locator('footer button').last().focus();await page.keyboard.press('Tab');assert.equal(await child.evaluate(node=>node.contains(document.activeElement)),true);
      await screenshot(`${title.replaceAll(' ','-')}-${width}-${dark?'dark':'light'}`);await page.keyboard.press('Escape');await profile.waitFor();
    }
    for(const section of ['Autenticação em dois fatores','Preferências da interface','Sessões ativas'])assert.equal(await profile.getByRole('heading',{name:section}).count(),1);
    await profile.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(await page.locator('#root').evaluate(n=>n.inert),false);
    await page.getByRole('button',{name:'Novo Membro',exact:true}).click();dialog=page.getByRole('dialog',{name:'Cadastrar Novo Membro'});
    await bounds(dialog);assert.equal(await dialog.getByLabel('Nome Completo').count(),1);
    await dialog.getByRole('button',{name:'Selecionar grupos do usuário'}).click();
    const group=dialog.getByRole('checkbox',{name:'Grupo fictício 7 Visualizar'});await group.scrollIntoViewIfNeeded();await group.check();assert.equal(await group.isChecked(),true);
    await group.focus();await page.keyboard.press('Escape');assert.equal(await dialog.getByRole('button',{name:'Selecionar grupos do usuário'}).getAttribute('aria-expanded'),'false');assert.equal(await dialog.count(),1);
    await screenshot(`create-${width}-${dark?'dark':'light'}`);await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
    await page.getByRole('dialog',{name:'Descartar alterações?'}).getByRole('button',{name:'Descartar',exact:true}).click();
    await page.getByRole('button',{name:'Editar',exact:true}).click();dialog=page.getByRole('dialog',{name:'Editar Usuário'});await bounds(dialog);
    await dialog.getByRole('button',{name:'Selecionar grupos do usuário'}).click();await dialog.getByRole('checkbox',{name:'Grupo fictício 0 Visualizar'}).check();await bounds(dialog);await screenshot(`edit-${width}-${dark?'dark':'light'}`);
    assert.equal(await dialog.getAttribute('data-form-dirty'),'true','group change marks edit form dirty');
    await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
    await page.getByRole('dialog',{name:'Descartar alterações?'}).getByRole('button',{name:'Descartar',exact:true}).click();
    assert.equal(await page.locator('#root').evaluate(n=>n.inert),false);
  }
  await page.setViewportSize({width:1280,height:800});await reload();
  await page.getByRole('button',{name:'Novo Membro',exact:true}).click();dialog=page.getByRole('dialog',{name:'Cadastrar Novo Membro'});
  await dialog.getByLabel('Nome Completo').fill('Novo fictício');await dialog.getByLabel('E-mail',{exact:true}).fill('created@example.invalid');await dialog.getByLabel('Senha de Acesso').fill('SYNTHETIC_CREATED_LOGIN_123!');
  await dialog.getByLabel('Nível de Acesso').selectOption('admin');await dialog.getByRole('button',{name:'Selecionar grupos do usuário'}).click();await dialog.getByRole('checkbox',{name:'Grupo fictício 3 Visualizar'}).check();
  await dialog.getByRole('checkbox',{name:/Exigir MFA/}).check();
  const createBefore=writes.filter(w=>w.path==='/api/users').length;
  delay=100;await dialog.getByRole('button',{name:'Salvar Usuário',exact:true}).evaluate(button=>{button.click();button.click();});
  await page.getByText('Usuário criado com sucesso!',{exact:true}).waitFor();delay=0;
  const creates=writes.filter(w=>w.path==='/api/users');assert.equal(creates.length,createBefore+1);assert.deepEqual(creates.at(-1).data.groupIds,['g3']);assert.equal(creates.at(-1).data.mfa_required,true);
  await page.getByRole('button',{name:'Editar',exact:true}).click();dialog=page.getByRole('dialog',{name:'Editar Usuário'});
  await dialog.getByLabel('Nome Completo').fill('Membro alterado fictício');await dialog.getByRole('button',{name:'Salvar Alterações',exact:true}).click();await page.getByText('Usuário atualizado com sucesso!',{exact:true}).waitFor();
  const edit=writes.findLast(w=>w.path.startsWith('/api/users/')&&w.path!=='/api/users/profile');assert.equal(edit.data.name,'Membro alterado fictício');assert.equal(edit.data.password,undefined);
  assert.deepEqual(errors,[]);
  console.log('PASS isolated browser actual components: ordered/read-only profile, email confirmation/logout, password/forced flow, failure/cleared secrets, vault local rewrap/API capture/lock cleanup, MFA/preferences/sessions, create/edit/group selection, stacking/hit-test/scroll/footer, dirty guard, 1280/390/320 light/dark. No VM or real installation accessed.');
}finally{await browser?.close();await vite.close();}
