/* global process */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createServer,transformWithOxc} from 'vite';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=process.env.MODAL_UI_EVIDENCE_DIR;
if(output)fs.mkdirSync(output,{recursive:true});
const baseline=process.env.MODAL_BASELINE==='1';
const fixture=`
import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';
import{AuthContext}from'/src/context/AuthContext.jsx';import ClientsList from'/src/pages/ClientsList.jsx';import TeamList from'/src/pages/TeamList.jsx';import api from'/src/services/api.js';import'/src/index.css';api.defaults.baseURL='/api';
const value={user:{id:'synthetic-admin',name:'Admin fictício',email:'admin@example.invalid',role:'admin',is_super_admin:true},masterKey:null,identityKeys:null,registerVaultLockCleanup:()=>()=>{}};
createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><AuthContext.Provider value={value}><main className="space-y-8 p-4"><ClientsList/><TeamList/></main></AuthContext.Provider></BrowserRouter></React.StrictMode>);
`;
const vite=await createServer({root,server:{host:'127.0.0.1',port:0},appType:'custom',plugins:[{
  name:'isolated-client-group-modals',enforce:'pre',
  resolveId(id){if(id==='virtual:modal-fixture')return'\0modal-fixture.jsx';},
  load(id){if(id==='\0modal-fixture.jsx')return fixture;},
  transform(code,id){
    if(id==='\0modal-fixture.jsx')return transformWithOxc(code,'modal-fixture.jsx');
    const file=id.replaceAll('\\','/');
    if(file.endsWith('/src/context/AuthContext.jsx'))return code+'\nexport {AuthContext};';
    if(baseline)for(const name of ['components/GroupModal.jsx','pages/ClientsList.jsx'])if(file.endsWith('/src/'+name))return execFileSync('git',['show','7deaa8236b541dc275befb93a95d04726cbf7b90:frontend/src/'+name],{cwd:root,encoding:'utf8'});
  },
  configureServer(server){server.middlewares.use('/__modal_fixture',async(_req,res,next)=>{try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__modal_fixture','<html lang="pt-BR"><head><title>Modais — teste isolado</title></head><body><div id="root"></div><script type="module">import "virtual:modal-fixture";</script></body></html>'));}catch(e){next(e);}});}
}]});
let browser;
try{
  await vite.listen();browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();
  const origin=`http://127.0.0.1:${vite.httpServer.address().port}`,writes=[],errors=[],observations=[];
  const users=[{id:'u1',name:'Membro fictício Um',email:'one@example.invalid',is_active:true,role:'user',groups:[]},{id:'u2',name:'Membro fictício Dois',email:'two@example.invalid',is_active:true,role:'user',groups:[]}];
  let groups=[{id:'g1',name:'Grupo fictício',description:'Descrição existente',can_view:true,can_edit:false,can_add:false,can_delete:false,users:[users[0]]},{id:'system',name:'Administradores',can_view:true,can_edit:true,can_add:true,can_delete:true,users:[]}],clients=[];
  let failWrite=false,failMembers=false,delay=0;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',async dialog=>{errors.push('Unexpected native '+dialog.type());await dialog.dismiss();});
  await context.addCookies([{name:'fp_csrf',value:'SYNTHETIC_CSRF',url:origin}]);
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'Fixture must never access the real installation or external services');
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(req.method()==='GET'){
      if(url.pathname==='/api/clients')return route.fulfill({json:clients});
      if(url.pathname==='/api/crypto/shared-items')return route.fulfill({json:{items:[]}});
      if(url.pathname==='/api/groups')return route.fulfill({json:groups});
      if(url.pathname==='/api/users')return route.fulfill(failMembers?{status:503,json:{error:'Falha fictícia'}}:{json:users});
      if(url.pathname==='/api/auth/password-policy')return route.fulfill({json:{login_min_length:12,login_rotation_months:12,vault_min_length:16,vault_rotation_months:12}});
    }else{
      assert.equal(req.headers()['x-csrf-token'],'SYNTHETIC_CSRF');
      const data=req.postDataJSON();writes.push({path:url.pathname,method:req.method(),data});
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      if(failWrite)return route.fulfill({status:503,json:{error:'Falha fictícia ao salvar. Tente novamente.'}});
      if(url.pathname==='/api/clients'){const client={id:'new-client-'+clients.length,...data};clients.push(client);return route.fulfill({json:client});}
      if(url.pathname==='/api/groups'){const group={id:'new-group-'+groups.length,...data,users:users.filter(u=>data.userIds.includes(u.id))};groups.push(group);return route.fulfill({json:group});}
      if(url.pathname==='/api/groups/g1'){groups=groups.map(g=>g.id==='g1'?{...g,...data,users:users.filter(u=>data.userIds.includes(u.id))}:g);return route.fulfill({json:groups.find(g=>g.id==='g1')});}
    }
    throw new Error('Unexpected fixture endpoint '+url.pathname);
  });
  const reload=async()=>{await page.goto(origin+'/__modal_fixture');await page.getByRole('button',{name:'Novo Cliente',exact:true}).waitFor();};
  const groupTab=()=>page.getByRole('button',{name:'Grupos',exact:true}).click();
  const open=async kind=>{
    if(kind==='client')await page.getByRole('button',{name:'Novo Cliente',exact:true}).click();
    else {await groupTab();if(kind==='new-group')await page.getByRole('button',{name:'Novo Grupo',exact:true}).click();else await page.getByRole('row').filter({hasText:'Grupo fictício'}).getByRole('button',{name:'Editar',exact:true}).click();}
    return page.getByRole('dialog',{name:kind==='client'?'Cadastrar Novo Cliente':kind==='new-group'?'Novo Grupo':'Editar Grupo',exact:true});
  };
  const screenshot=async name=>{if(output)await page.screenshot({path:path.join(output,name+'.png')});};
  const hit=control=>control.evaluate(node=>{const r=node.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),panel=node.closest('[data-modal-panel]')||node.closest('.transform'),style=getComputedStyle(panel);return{receives:node===top||node.contains(top),top:top?.outerHTML.slice(0,300),position:style.position,transform:style.transform,zIndex:style.zIndex};});
  if(baseline){
    for(const kind of ['client','new-group','edit-group']){
      await reload();const dialog=await open(kind);await dialog.waitFor();const input=dialog.locator('input[type=text]').first();await screenshot('before-'+kind);
      const detail=await hit(input);let blocked=false;try{await input.click({timeout:1200});}catch{blocked=true;}
      observations.push({kind,...detail,blocked});assert.equal(detail.receives,false);assert.equal(blocked,true);
    }
    if(output)fs.writeFileSync(path.join(output,'baseline.json'),JSON.stringify(observations,null,2)+'\n');
    console.log('Baseline: backdrop intercepts real clicks in all three affected modals',observations);process.exitCode=0;
  }else{
    const type=async(field,text)=>{await field.scrollIntoViewIfNeeded();assert.equal((await hit(field)).receives,true);await field.click();assert.equal(await field.evaluate(n=>document.activeElement===n),true);await field.press('ControlOrMeta+A');await field.pressSequentially(text);assert.equal(await field.inputValue(),text);};
    const dismiss=async dialog=>{await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();const confirm=page.getByRole('dialog',{name:'Descartar alterações?',exact:true});if(await confirm.isVisible())await confirm.getByRole('button',{name:'Descartar',exact:true}).click();await dialog.waitFor({state:'detached'});assert.equal(await page.locator('#root').evaluate(n=>n.inert),false);};
    const bounds=async dialog=>{
      const r=await dialog.boundingBox();const viewport=page.viewportSize();assert(r.x>=0&&r.y>=0&&r.x+r.width<=viewport.width+1&&r.y+r.height<=viewport.height+1);assert.equal(await dialog.evaluate(n=>n.scrollWidth>n.clientWidth),false);
      for(const control of await dialog.locator('input:not([disabled]),button:not([disabled])').all()){await control.scrollIntoViewIfNeeded();assert.equal((await hit(control)).receives,true,'No invisible layer may intercept a live control');}
      assert.equal(await page.locator('#root').evaluate(n=>n.inert),true);assert.equal(await dialog.evaluate(n=>n.closest('#root')),null);
    };
    for(const width of [1280,768,390])for(const dark of [false,true]){
      await page.setViewportSize({width,height:width===390?720:800});await page.emulateMedia({reducedMotion:dark?'reduce':'no-preference'});
      for(const kind of ['client','new-group','edit-group']){
        await reload();await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);const dialog=await open(kind);await dialog.waitFor();await bounds(dialog);
        const label=kind==='client'?'Nome da Empresa':'Nome do Grupo';const field=dialog.getByLabel(label,{exact:true});assert.equal(await field.evaluate(n=>n.labels.length>0),true);
        await type(field,'Registro fictício '+width);await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(n=>n.contains(document.activeElement)),true);
        if(kind==='client'){
          await type(dialog.getByLabel('Endereço Completo'),'Rua Fictícia, 123');await type(dialog.getByLabel('Telefone'),'(11) 0000-0000');await type(dialog.getByLabel('E-mail de Contato'),'fixture@example.invalid');
        }else{
          await type(dialog.getByLabel('Descrição (Opcional)'),'Descrição fictícia');await dialog.getByRole('checkbox',{name:'Editar',exact:true}).check();assert.equal(await dialog.getByRole('checkbox',{name:'Visualizar',exact:true}).isChecked(),true);
          await dialog.getByRole('checkbox',{name:/Membro fictício Dois/}).check();assert.equal(await dialog.getByRole('checkbox',{name:/Membro fictício Dois/}).isChecked(),true);
          if(kind==='edit-group')assert.equal(await dialog.getByRole('checkbox',{name:/Membro fictício Um/}).isChecked(),true);
        }
        await screenshot(kind+'-'+width+'-'+(dark?'dark':'light'));
        // Trap both edges using real keyboard events, then cancel/continue/discard.
        const buttons=dialog.locator('button:not([disabled])');await buttons.last().focus();await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(n=>n.contains(document.activeElement)),true);
        await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();const confirm=page.getByRole('dialog',{name:'Descartar alterações?',exact:true});await confirm.waitFor();await confirm.getByRole('button',{name:'Continuar editando'}).click();assert.equal(await field.inputValue(),'Registro fictício '+width);await dismiss(dialog);
      }
    }
    await page.setViewportSize({width:1280,height:800});await reload();let dialog=await open('client');
    await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await page.getByRole('button',{name:'Novo Cliente',exact:true}).evaluate(n=>n===document.activeElement),true);
    dialog=await open('new-group');await page.locator('[data-dialog-backdrop]').click({position:{x:2,y:2}});await dialog.waitFor({state:'detached'});assert.equal(await page.getByRole('button',{name:'Novo Grupo',exact:true}).evaluate(n=>n===document.activeElement),true);
    dialog=await open('client');
    await dialog.getByRole('button',{name:'Salvar Cliente',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.equal(await dialog.getByLabel('Nome da Empresa').evaluate(n=>n===document.activeElement),true);assert.equal(writes.length,0);
    for(const kind of ['client','new-group','edit-group']){
      if(kind!=='client'){await reload();dialog=await open(kind);}
      const field=dialog.getByLabel(kind==='client'?'Nome da Empresa':'Nome do Grupo',{exact:true});await type(field,'Salvo fictício '+kind);
      if(kind==='client')await type(dialog.getByLabel('E-mail de Contato'),'save@example.invalid');
      else {await dialog.getByRole('checkbox',{name:'Adicionar',exact:true}).check();await dialog.getByRole('checkbox',{name:/Membro fictício Dois/}).check();}
      const submit=dialog.getByRole('button',{name:kind==='client'?'Salvar Cliente':'Salvar Grupo',exact:true});failWrite=true;await submit.click();await dialog.getByRole('alert').waitFor();assert.equal(await field.inputValue(),'Salvo fictício '+kind);failWrite=false;delay=150;
      const count=writes.length;await submit.evaluate(b=>{b.click();b.click();});await dialog.waitFor({state:'detached'});assert.equal(writes.length,count+1);assert.equal(await page.locator('#root').evaluate(n=>n.inert),false);delay=0;
    }
    // Reopen edit to prove filled values/members survived the successful API round-trip.
    await reload();await groupTab();await page.getByRole('row').filter({hasText:'Salvo fictício edit-group'}).getByRole('button',{name:'Editar',exact:true}).click();dialog=page.getByRole('dialog',{name:'Editar Grupo',exact:true});assert.equal(await dialog.getByLabel('Nome do Grupo').inputValue(),'Salvo fictício edit-group');assert.equal(await dialog.getByRole('checkbox',{name:/Membro fictício Dois/}).isChecked(),true);await dismiss(dialog);
    await page.getByRole('row').filter({hasText:'Administradores'}).getByRole('button',{name:'Editar',exact:true}).click();dialog=page.getByRole('dialog',{name:'Editar Grupo',exact:true});assert.equal(await dialog.getByLabel('Nome do Grupo').isDisabled(),true);for(const name of ['Visualizar','Editar','Adicionar','Excluir'])assert.equal(await dialog.getByRole('checkbox',{name,exact:true}).isDisabled(),true);await dismiss(dialog);
    // The canonical sibling member modal remains interactive after repeated opens/closes.
    await page.getByRole('button',{name:'Usuários',exact:true}).click();await page.getByRole('button',{name:'Novo Membro',exact:true}).click();dialog=page.getByRole('dialog',{name:'Cadastrar Novo Membro',exact:true});await type(dialog.getByLabel('Nome Completo',{exact:true}),'Membro de regressão');await dismiss(dialog);
    assert.equal(errors.length,0,errors.join('\n'));
    const result={client:'PASS',newGroup:'PASS',editGroup:'PASS',viewports:[1280,768,390],themes:['light','dark'],realClickAndTyping:'PASS',hitTesting:'PASS',keyboard:'PASS',saveCancelRetry:'PASS',duplicatePrevention:'PASS',systemGroupRestrictions:'PASS',memberModalRegression:'PASS',realInstallationAccessed:false,apiMode:'synthetic intercepted localhost only',pageErrors:errors};
    if(output)fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  }
}finally{await browser?.close();await vite.close();}
