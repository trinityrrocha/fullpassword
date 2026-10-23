/* global process */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, transformWithOxc } from 'vite';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href:'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=process.env.CLIENT_IP_UI_EVIDENCE_DIR;
if(output)fs.mkdirSync(output,{recursive:true});
const fixture=`import React from 'react';import{createRoot}from'react-dom/client';import ClientIpStatus from '/src/components/ClientIpStatus.jsx';import SettingsAccordionCard from '/src/components/SettingsAccordionCard.jsx';import api from '/src/services/api.js';import '/src/index.css';api.defaults.baseURL='/api';createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-4xl p-4"><SettingsAccordionCard id="security-card" title="Segurança"><ClientIpStatus/></SettingsAccordionCard></main>);`;
const vite=await createServer({root,server:{host:'127.0.0.1',port:0},appType:'custom',plugins:[{name:'client-ip-fixture',enforce:'pre',resolveId(id){if(id==='virtual:client-ip')return '\0client-ip.jsx';},load(id){if(id==='\0client-ip.jsx')return fixture;},transform(code,id){if(id==='\0client-ip.jsx')return transformWithOxc(code,'client-ip.jsx');},configureServer(server){server.middlewares.use('/__client_ip_fixture',async(_req,res,next)=>{try{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__client_ip_fixture','<html lang="pt-BR"><head><title>Client IP — teste isolado</title></head><body><div id="root"></div><script type="module">import "virtual:client-ip";</script></body></html>'));}catch(error){next(error);}});}}]});
let browser;
try{
  await vite.listen();browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
  const origin='http://127.0.0.1:'+vite.httpServer.address().port;
  let mode='cloudflare_tunnel',failed=false,delay=0;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());assert.equal(url.origin,origin,'No external or installed application access');
    if(!url.pathname.startsWith('/api/'))return route.continue();
    assert.equal(route.request().method(),'GET');assert.equal(url.pathname,'/api/system/client-ip-status');
    if(delay)await new Promise(r=>setTimeout(r,delay));
    return route.fulfill(failed?{status:503,json:{error:'SYNTHETIC_FAILURE'}}:{json:{mode,client_ip:'2001:db8:0:0:0:0:0:1234',cloudflare:mode!=='direct',cf_ray_present:mode!=='direct',defined_in_deployment:true}});
  });
  const open=async()=>{await page.goto(origin+'/__client_ip_fixture');const toggle=page.getByRole('button',{name:'Segurança',exact:true});assert.equal(await toggle.getAttribute('aria-expanded'),'false');await toggle.focus();await page.keyboard.press('Enter');};
  for(const next of ['direct','cloudflare_proxy','cloudflare_tunnel']){
    mode=next;await open();await page.getByText('IP real validado',{exact:true}).waitFor();
    assert.equal(await page.locator('select').count(),0,'Topology must not be editable');
    assert(await page.getByText('2001:db8:0:0:0:0:0:1234',{exact:true}).isVisible());
  }
  failed=true;await open();await page.getByRole('alert').waitFor();
  failed=false;await page.getByRole('button',{name:'Tentar novamente'}).focus();await page.keyboard.press('Enter');await page.getByText('IP real validado',{exact:true}).waitFor();
  delay=700;await open();await page.getByText('Consultando origem dos IPs...',{exact:true}).waitFor();await page.getByText('IP real validado',{exact:true}).waitFor();delay=0;
  for(const width of [1280,390,320])for(const dark of [false,true]){
    await page.setViewportSize({width,height:800});await page.evaluate(d=>document.documentElement.classList.toggle('dark',d),dark);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(output)await page.screenshot({path:path.join(output,`client-ip-${width}-${dark?'dark':'light'}.png`),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  const report={result:'PASS',fixtureOnly:true,externalRequests:false,states:['loading','success','failure','keyboard retry'],modes:['direct','cloudflare_proxy','cloudflare_tunnel'],viewports:[1280,390,320],themes:['light','dark'],accordionClosedByDefault:true,topologyReadOnly:true,browserErrors:errors};
  if(output)fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();await vite.close();}
