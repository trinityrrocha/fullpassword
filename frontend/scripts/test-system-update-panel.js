import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { describeSystemUpdate, shortReleaseRevision } from '../src/utils/systemUpdatePresentation.js';

const current = 'a'.repeat(40);
const next = 'b'.repeat(40);
const release = {approvalId:'00000000-0000-4000-8000-000000000001',revision:next,manifestHash:'c'.repeat(64),origin:'https://test.example.invalid',backend:`example.invalid/backend@sha256:${'d'.repeat(64)}`,frontend:`example.invalid/frontend@sha256:${'e'.repeat(64)}`,expiresAt:'2099-01-01T00:00:00Z'};
const versions = {backend:current,frontend:current};
const agent = {release:null,progress:null,requested:false};
const show = (changes = {}) => describeSystemUpdate({versions,agent,...changes});
const progress = state => ({approvalId:release.approvalId,revision:next,state});
assert.equal(shortReleaseRevision(current),'aaaaaaaa');
for(const value of [null,undefined,'unknown','abc','<script>']) assert.equal(shortReleaseRevision(value),'Não identificada');
assert.equal(show().state,'none');
assert.equal(show({loading:true}).state,'loading');
assert.equal(show({error:'network'}).state,'unavailable');
assert.equal(show({versions:{backend:current,frontend:next}}).state,'mismatch');
assert.equal(show({versions:{backend:null,frontend:current}}).state,'unidentified');
assert.equal(show({agent:{...agent,release}}).state,'available');
assert.equal(show({agent:{...agent,release:{...release,revision:current}}}).state,'current');
for(const state of ['requested','deploying','stabilizing','recovery_required']) {
  const result=show({agent:{release,progress:progress(state),requested:true}});
  assert.equal(result.state,state); assert.equal(result.canRequest,false);
}
const complete={versions:{backend:next,frontend:next},agent:{release,progress:progress('completed'),requested:true}};
assert.equal(show(complete).state,'completed');
assert.equal(show(complete).canRequest,false,'preserved one-shot request does not appear stuck');
assert.equal(show({...complete,agent:{...complete.agent,release:null,requested:false}}).state,'completed','completed remains clear after catalog expiry');
assert.equal(show({agent:{release,progress:progress('completed'),requested:true}}).state,'verifying','agent completion alone is not proof of running revisions');
assert.equal(show({agent:{release,progress:{...progress('completed'),approvalId:'old-approval'},requested:true}}).state,'requested','old progress is not the new request');
const newer=show({agent:{release,progress:{...progress('completed'),approvalId:'old-approval'},requested:false}});
assert.equal(newer.state,'available'); assert.equal(newer.phase,undefined,'old timeline cannot masquerade as current');
assert.equal(show({agent:{release,progress:progress('unknown'),requested:false}}).state,'unknown');
assert.equal(show({agent:{...agent,release},error:'network'}).canRequest,false);

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(frontendRoot,file),'utf8');
const vite=await createServer({root:frontendRoot,server:{middlewareMode:true},appType:'custom'});
try {
  const {default:View}=await vite.ssrLoadModule('/src/components/SystemUpdateView.jsx');
  const render = (props={}) => renderToStaticMarkup(createElement(View,{versions,agent,error:'',busy:false,loading:false,onRequest:()=>{},onRefresh:()=>{},...props}));
  const html=render({agent:{...agent,release}});
  assert.match(html,/Versão atual/); assert.match(html,/Nova versão/);
  assert.match(html,/aaaaaaaa/); assert.match(html,/bbbbbbbb/);
  assert.match(html,/Atualizar sistema/); assert.match(html,/Mais informações/);
  assert.match(html,/aria-expanded="false"/); assert.match(html,/hidden=""/);
  const summary=html.slice(0,html.indexOf('Detalhes técnicos e segurança'));
  for(const technical of [current,next,release.manifestHash,release.backend,release.frontend,'O atualizador antigo','A primeira instalação']) assert(!summary.includes(technical),technical+' leaked into compact summary');
  for(const technical of [current,next,release.manifestHash,release.backend,release.frontend,release.approvalId]) assert(html.includes(technical),'full technical value preserved');
  assert(!render(complete).includes('aria-label="Atualizar sistema"'));
  assert.match(render(complete),/Sistema atualizado/);
  for(const state of ['requested','deploying','stabilizing','completed','recovery_required']) {
    const view=render({agent:{release,progress:progress(state),requested:true},...(state==='completed'?{versions:complete.versions}:{})});
    assert.match(view,new RegExp(`data-update-state="${state}"`));
    assert(!view.includes('aria-label="Atualizar sistema"'));
  }
  assert.match(render({agent:{...agent,release},busy:true}),/disabled="" aria-busy="true"/);
  assert.match(render({agent:{...agent,release:{...release,version:'v2.0.0'}}}),/v2.0.0/);
  for(const markup of [html,render(complete),render({error:'Falha de consulta'})]) assert.doesNotMatch(markup,/A atualização exige senha|senha de login recente e MFA/);
  assert.match(render({agent:{...agent,release:{...release,origin:'<script>unsafe</script>'}}}),/&lt;script&gt;unsafe&lt;\/script&gt;/);
} finally { await vite.close(); }
const panel=read('src/components/UpdateStatusPanel.jsx');
assert.match(panel,/pending.current \|\| !release \|\| active/);
assert.match(panel,/api.post\('\/system\/update', \{ approvalId: release.approvalId, revision: release.revision, manifestHash: release.manifestHash \}/);
assert.match(panel,/abort.abort\(\); clearTimeout\(timer\)/);
assert.doesNotMatch(panel,/auth\/reauth|_reauth_token|localStorage|sessionStorage/);
assert.doesNotMatch(read('src/components/SystemUpdateView.jsx'),/api\.|fetch\(|localStorage|sessionStorage|alert\(|confirm\(|prompt\(/);
console.log('System update panel: presentation states, actual JSX, collapsed full details, uncertain completion, legacy text removal and unchanged request contract PASS.');
