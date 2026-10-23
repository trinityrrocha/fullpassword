// Offline preparation only. Emits unsigned bytes for review and external signing.
// Never fetches GitHub, creates an approval or invokes deployment.
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const {validateChanges} = require('./deploy-approved-release');
const relevant = new Set(['fix','feat','security','perf','release']);
const changesFromSubjects = subjects => validateChanges(subjects.flatMap(subject => {
  const match = /^(fix|feat|security|perf|release)(?:\([^\r\n)]+\))?!?: (.+)$/u.exec(subject);
  return match && relevant.has(match[1]) ? [{type:match[1],title:match[2]}] : [];
}).filter((item,index,items) => items.findIndex(other => other.type===item.type && other.title===item.title)===index));
function prepareManifest(manifest, from, to, explicitChanges) {
  if (!/^[a-f0-9]{40}$/.test(from) || !/^[a-f0-9]{40}$/.test(to) || manifest.revision!==to) throw new Error('EXACT_RELEASE_RANGE_REQUIRED');
  execFileSync('git',['merge-base','--is-ancestor',from,to],{stdio:'pipe',windowsHide:true});
  const subjects = execFileSync('git',['log','--reverse','--format=%s',from+'..'+to],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/);
  return {...manifest,changes:explicitChanges===undefined ? changesFromSubjects(subjects) : validateChanges(explicitChanges)};
}
if (require.main===module) {
  try {
    const [manifestFile,from,to,reviewedNotes] = process.argv.slice(2);
    if (!manifestFile || !from || !to || process.argv.length>6) throw new Error('Usage: node prepare-release-manifest.js manifest.json FROM_SHA TO_SHA [reviewed-changes.json]');
    process.stdout.write(JSON.stringify(prepareManifest(JSON.parse(fs.readFileSync(manifestFile,'utf8')),from,to,reviewedNotes ? JSON.parse(fs.readFileSync(reviewedNotes,'utf8')) : undefined),null,2)+'\n');
  } catch (error) {console.error(error.message);process.exitCode=1;}
}
module.exports={changesFromSubjects,prepareManifest};
