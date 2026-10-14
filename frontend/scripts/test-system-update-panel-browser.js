/* global process */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, transformWithOxc } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.UPDATE_UI_EVIDENCE_DIR;
if (output) fs.mkdirSync(output, {recursive:true});
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import UpdateStatusPanel from '/src/components/UpdateStatusPanel.jsx';
import SettingsAccordionCard from '/src/components/SettingsAccordionCard.jsx';
import api from '/src/services/api.js';
import '/src/index.css';
api.defaults.baseURL='/api';
createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-4xl p-4"><SettingsAccordionCard id="system-update" title="Atualização do Sistema" defaultOpen badge={<span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Super Admin</span>}><p className="mb-4 text-sm text-slate-600 dark:text-slate-300">Consulte a versão instalada e mantenha o sistema atualizado com segurança.</p><UpdateStatusPanel /></SettingsAccordionCard></main>);
`;
const vite=await createServer({root,server:{host:'127.0.0.1',port:0},appType:'custom',plugins:[{
  name:'system-update-isolated-fixture',enforce:'pre',
  resolveId(id){if(id==='virtual:update-fixture')return '\0update-fixture.jsx';},
  load(id){if(id==='\0update-fixture.jsx')return fixture;},
  transform(code,id){if(id==='\0update-fixture.jsx')return transformWithOxc(code,'update-fixture.jsx');},
  configureServer(server){server.middlewares.use('/__update_fixture',async(_req,res,next)=>{
    try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__update_fixture','<html lang="pt-BR"><head><title>WebUpdate — teste isolado</title></head><body><div id="root"></div><script type="module">import "virtual:update-fixture";</script></body></html>'));}catch(e){next(e);}
  });}
}]});
let browser;
try{
  await vite.listen();
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});
  const page=await context.newPage();
  const current='a'.repeat(40),next='b'.repeat(40);
  const release={approvalId:'00000000-0000-4000-8000-000000000001',revision:next,manifestHash:'c'.repeat(64),origin:'https://test.example.invalid',backend:`example.invalid/backend@sha256:${'d'.repeat(64)}`,frontend:`example.invalid/frontend@sha256:${'e'.repeat(64)}`,expiresAt:'2099-01-01T00:00:00Z'};
  let agent={release,progress:null,requested:false},running=current,failRead=false,postFailure=false,delay=0;
  const posts=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
  await context.addCookies([{name:'fp_csrf',value:'SYNTHETIC_CSRF',url:origin}]);
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    assert.equal(url.origin,origin,'fixture must never access real installation or external services');
    if(url.pathname==='/version.json')return route.fulfill({json:{revision:running}});
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(request.method()==='POST'){
      assert.equal(url.pathname,'/api/system/update');
      assert.equal(request.headers()['x-csrf-token'],'SYNTHETIC_CSRF');
      const payload=request.postDataJSON();
      assert.deepEqual(payload,{approvalId:release.approvalId,revision:release.revision,manifestHash:release.manifestHash});
      posts.push(payload);
      if(postFailure)return route.fulfill({status:503,json:{error:'SYNTHETIC_FAILURE'}});
      agent={release,requested:true,progress:{approvalId:release.approvalId,revision:next,state:'requested'}};
      return route.fulfill({status:202,json:{state:'requested'}});
    }
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    if(failRead)return route.fulfill({status:503,json:{error:'SYNTHETIC_OFFLINE'}});
    if(url.pathname==='/api/system/update/status')return route.fulfill({json:agent});
    if(url.pathname==='/api/health')return route.fulfill({json:{schema_ready:true,commit:running}});
    throw new Error('Unexpected API route: '+url.pathname);
  });
  const open=async(state)=>{await page.goto(origin+'/__update_fixture');await page.locator(`[data-update-state="${state}"]`).waitFor();};
  const screenshot=async name=>{if(output)await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});};
  await open('available');
  const details=page.getByRole('button',{name:'Mais informações'});
  assert.equal(await details.getAttribute('aria-expanded'),'false');
  assert.equal(await page.getByRole('heading',{name:'Detalhes técnicos e segurança'}).isVisible(),false);
  const summary=await page.locator('[data-update-summary]').innerText();
  assert(summary.includes('aaaaaaaa')&&summary.includes('bbbbbbbb'));
  for(const raw of [current,next,release.backend,release.manifestHash])assert(!summary.includes(raw));
  await screenshot('available-desktop');
  await details.focus();await page.keyboard.press('Enter');
  assert.equal(await details.getAttribute('aria-expanded'),'true');
  assert.equal(await page.getByText(release.backend,{exact:true}).isVisible(),true);
  await screenshot('details-desktop');
  await page.keyboard.press('Space');
  assert.equal(await details.getAttribute('aria-expanded'),'false');
  await page.getByRole('button',{name:'Atualizar sistema',exact:true}).evaluate(button=>{button.click();button.click();});
  await page.locator('[data-update-state="requested"]').waitFor();
  assert.equal(posts.length,1,'rapid activation must not double POST');
  assert.equal(await page.getByRole('button',{name:'Atualizar sistema',exact:true}).count(),0);
  for(const state of ['deploying','stabilizing','completed','recovery_required']){
    agent={release,requested:true,progress:{approvalId:release.approvalId,revision:next,state,backend:release.backend,frontend:release.frontend}};
    running=state==='completed'?next:current;
    await page.getByRole('button',{name:'Consultar progresso'}).click();
    await page.locator(`[data-update-state="${state}"]`).waitFor();
    assert.equal(posts.length,1,'GET progress is not another update request');
    if(state==='completed'){
      assert.equal(await page.getByText('Sistema atualizado',{exact:true}).isVisible(),true);
      await screenshot('completed-desktop');
    }
  }
  agent={release:null,progress:null,requested:false};running=current;
  await open('none');
  assert.equal(await page.getByRole('button',{name:'Atualizar sistema',exact:true}).count(),0);
  failRead=true;await open('unavailable');
  assert.equal(await page.getByRole('button',{name:'Consultar progresso'}).isVisible(),true);
  failRead=false;await page.getByRole('button',{name:'Consultar progresso'}).click();
  await page.locator('[data-update-state="none"]').waitFor();
  agent={release,progress:null,requested:false};delay=250;
  await page.goto(origin+'/__update_fixture');
  await page.locator('[data-update-state="loading"]').waitFor();
  await page.locator('[data-update-state="available"]').waitFor();delay=0;
  postFailure=true;
  await page.getByRole('button',{name:'Atualizar sistema',exact:true}).click();
  await page.waitForResponse(r=>r.request().method()==='GET'&&r.url().endsWith('/api/system/update/status'));
  await page.locator('[data-update-state="available"]').waitFor();
  assert.equal(posts.length,2,'uncertain request never retries POST automatically');postFailure=false;
  for(const width of [1280,390,320])for(const dark of [false,true]){
    await page.setViewportSize({width,height:850});
    await page.evaluate(value=>document.documentElement.classList.toggle('dark',value),dark);
    for(const expanded of [false,true]){
      const toggle=page.getByRole('button',{name:'Mais informações'});
      if((await toggle.getAttribute('aria-expanded')==='true')!==expanded)await toggle.click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
      assert.equal(await page.getByRole('button',{name:'Atualizar sistema',exact:true}).isVisible(),true);
      const label=expanded?'details':'compact';
      if(width!==1280)await screenshot(`${label}-${width}-${dark?'dark':'light'}`);
    }
  }
  assert.equal(await page.locator('body').innerText().then(t=>t.includes('A atualização exige senha')),false);
  assert.deepEqual(errors,[]);
  console.log('PASS isolated browser: keyboard disclosure, request payload/CSRF/duplicate guard, all phases, refresh, failed GET/POST, loading, 320/390/1280 light/dark, long digests and reduced motion. No real system accessed.');
}finally{await browser?.close();await vite.close();}
