const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {createApp}=require('../src/server.cjs');
const {importContent}=require('../src/content-store.cjs');
(async()=>{
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'adsp-admin-'));
const database=path.join(folder,'test.sqlite');
let server=createApp({database});
let base;
async function start(){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;}
await start();
async function req(route,{method='POST',data={},user,origin=base}={}){
  const response=await fetch(base+route,{method,headers:{...(method==='GET'?{}:{'Content-Type':'application/json',Origin:origin}),...(user?{Cookie:user.cookie,'X-Study-User':String(user.id)}:{})},body:method==='GET'?undefined:JSON.stringify(data)});
  return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
const validate=(user,data)=>req('/api/admin/content/validate',{user,data});
const commit=(user,token)=>req('/api/admin/content/import',{user,data:{validation_token:token}});
const credentials=email=>({email,password:'test-password-123',role:'admin'});
async function signup(email){const result=await req('/api/register',{data:credentials(email)});assert.equal(result.status,200);assert.equal(result.body.user.role,'member');return {id:result.body.user.id,cookie:result.cookie,email};}
const command=(action,email)=>spawnSync(process.execPath,['scripts/manage-admin.cjs',action,email,'--database',database],{encoding:'utf8'});
const jsonInput={filename:'example.json',content:fs.readFileSync('content/example.json','utf8'),subject_id:'analysis-planning',unit_id:'planning-basics'};
const db=()=>new DatabaseSync(database);
const counts=()=>{const d=db();try{return [d.prepare('SELECT count(*) n FROM content_lessons').get().n,d.prepare('SELECT count(*) n FROM content_questions').get().n,d.prepare('SELECT count(*) n FROM content_imports').get().n];}finally{d.close();}};
try{
assert.equal((await validate(null,jsonInput)).status,401);
const member=await signup('member@example.test'),admin=await signup('admin@example.test'),second=await signup('second@example.test');
assert.equal((await validate(member,jsonInput)).status,403);assert.equal((await commit(member,'a'.repeat(64))).status,403);
assert.equal(command('grant','missing@example.test').status,1);
assert.equal(command('grant',admin.email).status,0);assert.equal(command('grant',second.email).status,0);
assert.equal((await req('/api/me',{method:'GET',user:admin})).body.user.role,'admin');
const record={version:1,completed:[0],answers:{q1:2},selectedUnitId:'data-information'};
assert.equal((await req('/api/progress',{method:'PUT',user:member,data:record})).status,200);
assert.equal((await req('/api/admin/content/validate',{user:admin,data:jsonInput,origin:'https://evil.test'})).status,403);
assert.equal((await commit(admin,null)).status,400);
for(const invalid of [{...jsonInput,filename:'bad.exe'},{...jsonInput,content:'{'},{...jsonInput,content:'null'},{...jsonInput,unit_id:'statistics-basics'},{...jsonInput,content:JSON.stringify({units:[{id:'x',title:'x',subject_id:'analysis-planning'}]})}]){const r=await validate(admin,invalid);assert.equal(r.status,422);assert.equal(r.body.valid,false);}
assert.equal((await validate(admin,{...jsonInput,content:'x'.repeat(2*1024*1024+1)})).status,413);
assert.deepEqual(counts(),[3,6,0]);
let preview=await validate(admin,jsonInput);assert.equal(preview.status,200,preview.body.error);assert.equal(preview.body.valid,true);assert.equal(preview.body.preview.length,2);assert.equal(preview.body.counts.lessons,1);assert.deepEqual(counts(),[3,6,0]);
assert.equal((await commit(member,preview.body.validation_token)).status,403);
assert.equal((await commit(second,preview.body.validation_token)).status,409);
const anotherSession=await req('/api/login',{data:credentials(admin.email)});const other={...admin,cookie:anotherSession.cookie};
assert.equal((await commit(other,preview.body.validation_token)).status,409);
const stored=await commit(admin,preview.body.validation_token);assert.equal(stored.status,200);assert.deepEqual(counts(),[4,7,1]);assert.equal((await commit(admin,preview.body.validation_token)).status,409);
const content=await req('/api/content',{method:'GET'});assert.equal(content.body.lessons.find(l=>l.id==='data-quality').unit_id,'planning-basics');assert.equal(content.body.questions.find(q=>q.id==='quality-q1').unit_id,'planning-basics');
assert.deepEqual((await req('/api/progress',{method:'GET',user:member})).body.progress,record);
assert.equal((await validate(admin,jsonInput)).status,422);assert.deepEqual(counts(),[4,7,1]);
const cross={questions:[{id:'cross-q',lesson_id:'l1',text:'a',options:['a','b','c','d'],answer:0,explanation:'a'}]};assert.equal((await validate(admin,{...jsonInput,content:JSON.stringify(cross)})).status,422);
const csvInput={filename:'example.csv',content:fs.readFileSync('content/example.csv','utf8'),subject_id:'data-understanding',unit_id:'database-basics'};
preview=await validate(admin,csvInput);assert.equal(preview.status,200);const previousToken=preview.body.validation_token;
assert.equal((await validate(admin,{...csvInput,content:'type,id\nlesson,"bad'})).status,422);assert.equal((await commit(admin,previousToken)).status,409);
preview=await validate(admin,csvInput);assert.equal((await commit(admin,preview.body.validation_token)).status,200);assert.deepEqual(counts(),[5,8,2]);
const qOnly={filename:'only.json',subject_id:'data-understanding',unit_id:'data-information',content:JSON.stringify({questions:[{...cross.questions[0],id:'only-q'}]})};
preview=await validate(admin,qOnly);assert.equal(preview.body.counts.lessons,0);assert.equal(preview.body.counts.questions,1);
let d=db();d.prepare('UPDATE content_uploads SET expires=0').run();d.close();assert.equal((await commit(admin,preview.body.validation_token)).status,409);
preview=await validate(admin,qOnly);const freshToken=preview.body.validation_token;
const conflict={lessons:[{id:'race-lesson',title:'race',body:'race'}],questions:[{...cross.questions[0],id:'race-q',lesson_id:'race-lesson'}]};
preview=await validate(admin,{...qOnly,content:JSON.stringify(conflict)});assert.equal(preview.status,200);
d=db();importContent(d,{lessons:conflict.lessons});d.close();assert.equal((await commit(admin,preview.body.validation_token)).status,409);assert.deepEqual(counts(),[6,8,2]);
// A new preview invalidates the previous one, even when the payload is otherwise valid.
assert.equal((await commit(admin,freshToken)).status,409);
preview=await validate(admin,qOnly);assert.equal(preview.status,200);assert.equal(command('revoke',admin.email).status,0);
assert.equal((await commit(admin,preview.body.validation_token)).status,403);assert.equal((await validate(admin,qOnly)).status,403);assert.equal((await req('/api/me',{method:'GET',user:admin})).body.user.role,'member');
await new Promise(resolve=>server.close(resolve));server=createApp({database});await start();assert.equal((await req('/api/me',{method:'GET',user:second})).body.user.role,'admin');assert.deepEqual(counts(),[6,8,2]);
console.log('PASS: explicit admin roles, no signup escalation, guest/member denial, CSRF, JSON/CSV validation, target assignment, preview-only behavior, session/user binding, one-time tokens, expiry, revocation, conflict rollback, audit and progress preservation');
}finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(folder,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
