const assert = require('node:assert/strict');
const { discover } = require('../src/services/mainCiRelease');
const installed = 'a'.repeat(40), head = 'b'.repeat(40), repo = 'trinityrrocha/fullpassword';
function fixture() {
  const run = {workflow_id:361010180, path:'.github/workflows/security-regression.yml', event:'push', head_branch:'main', head_sha:head,
    repository:{full_name:repo}, head_repository:{full_name:repo}, id:12, run_attempt:2, status:'completed', conclusion:'success'};
  const jobs = ['regression','images','release-candidate / candidate'].map(name=>({name, head_sha:head, conclusion:'success'}));
  jobs[2].steps = ['backend','frontend'].map(s=>({name:'WebUpdate '+s+' ghcr.io/'+repo+'-'+s+'@sha256:'+'c'.repeat(64), conclusion:'success'}));
  const compare = {status:'ahead',merge_base_commit:{sha:installed}};
  const responses = new Map([
    ['git/ref/heads/main',{object:{type:'commit',sha:head}}],
    ['actions/workflows/361010180/runs?branch=main&event=push&head_sha='+head+'&per_page=1',{workflow_runs:[run]}],
    ['actions/runs/12/attempts/2/jobs?per_page=100',{jobs}],
    ['compare/'+installed+'...'+head+'?per_page=1',compare]
  ]);
  const fetcher = async (url, opts) => {
    assert.equal(opts.redirect, 'error');
    assert.ok(url.startsWith('https://api.github.com/repos/'+repo+'/'));
    const entry = responses.get(url.slice(('https://api.github.com/repos/'+repo+'/').length));
    assert.ok(entry);return new Response(JSON.stringify(entry));
  };
  return {run,jobs,compare,fetcher};
}
(async()=>{
  let f=fixture();
  const good=await discover(installed,f.fetcher);
  assert.equal(good.state,'available');assert.equal(good.release.revision,head);
  assert.equal((await discover(head,f.fetcher)).state,'current');
  assert.equal((await discover(installed,f.fetcher,Date.now()+1000)).hash,good.hash);
  for(const mutate of [
    x=>{x.run.event='pull_request';},x=>{x.run.head_repository.full_name='fork/project';},
    x=>{x.jobs[1].conclusion='skipped';},x=>{x.jobs[2].head_sha=installed;},
    x=>{x.jobs[2].steps[0].name='WebUpdate backend ghcr.io/'+repo+'-backend:latest';},
    x=>{x.jobs[2].steps[1].conclusion='failure';}
  ]){f=fixture();mutate(f);await assert.rejects(discover(installed,f.fetcher));}
  f=fixture();f.run.conclusion='failure';assert.equal((await discover(installed,f.fetcher)).state,'unavailable');
  f=fixture();f.compare.status='diverged';assert.equal((await discover(installed,f.fetcher)).state,'unrecognized');
  console.log('PASS main CI discovery: exact SHA/digests, fork/PR/jobs, ancestry, no downgrade');
})().catch(e=>{console.error(e);process.exitCode=1;});
