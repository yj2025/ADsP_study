const {createApp}=require('../src/server.cjs');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {mkdtempSync,rmSync}=require('node:fs');
const path=require('node:path');
const os=require('node:os');
(async()=>{
const directory=mkdtempSync(path.join(os.tmpdir(),'adsp-auth-'));
const database=path.join(directory,'test.sqlite');
const mail=[];const sendMail=async message=>{mail.push(message);};
let server=createApp({database,sendMail});
async function listen(){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;}
let base=await listen();
async function request(route,{method='GET',data,cookie,origin=base,userId}={}){const response=await fetch(base+route,{method,headers:{...(method!=='GET'?{'Content-Type':'application/json',Origin:origin}:{}),...(cookie?{Cookie:cookie}:{}),...(userId?{'X-Study-User':String(userId)}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {response,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
const credentials={email:'student@example.test',password:'test-password-123'};
const mailToken=()=>new URL(mail.at(-1).link).hash.split('=')[1];
const post=(route,data)=>request(route,{method:'POST',data});
async function signup(data){
  const response=await post('/api/register',data);assert.equal(response.response.status,202);assert.equal(response.cookie,undefined);assert.equal(response.body.delivery,true);
  assert.equal((await post('/api/login',data)).body.code,'EMAIL_UNVERIFIED');
  const token=mailToken();assert.equal(mail.at(-1).to,data.email);
  assert.equal((await post('/api/email/verify',{token,password:'wrong-password'})).response.status,401);
  assert.equal((await post('/api/email/verify',{token,password:data.password})).response.status,200);
  assert.equal((await post('/api/email/verify',{token,password:data.password})).response.status,400);
  return post('/api/login',data);
}
try{
const initial=await request('/api/content');assert.equal(initial.response.status,200);assert.equal(initial.body.lessons.length,3);assert.equal(initial.body.questions.length,6);
assert.equal(initial.body.subjects.length,3);assert.equal(initial.body.units.length,4);assert.equal(initial.body.lessons[0].unit_id,'data-information');
const contentDB=new DatabaseSync(database);const {importContent}=require('../src/content-store.cjs');importContent(contentDB,JSON.parse(require('node:fs').readFileSync('content/example.json','utf8')));contentDB.close();
const expanded=await request('/api/content');assert.equal(expanded.body.lessons.length,4);assert.equal(expanded.body.questions[6].lesson_id,'data-quality');assert.equal(expanded.body.questions[6].lesson,3);
assert.equal((await request('/api/progress')).response.status,401);
assert.equal((await request('/api/register',{method:'POST',data:credentials,origin:'https://evil.test'})).response.status,403);
assert.equal((await request('/api/register',{method:'POST',data:{email:'x',password:'short'}})).response.status,400);
const a=await signup(credentials);assert.equal(a.response.status,200);assert.match(a.response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.equal(a.body.user.email,credentials.email);
assert.equal((await request('/api/register',{method:'POST',data:credentials})).response.status,409);
assert.equal((await request('/api/login',{method:'POST',data:{...credentials,password:'wrong-password'}})).response.status,401);
const record={version:1,completed:[0,1],answers:{q1:2},lesson:2,wrong:[],resolved:[],quizIndex:1};
assert.equal((await request('/api/progress',{method:'PUT',cookie:a.cookie,data:record,userId:a.body.user.id})).response.status,200);
const b=await signup({...credentials,email:'other@example.test'});
assert.equal((await request('/api/progress',{cookie:b.cookie})).body.progress,null);
assert.equal((await request('/api/progress',{method:'PUT',cookie:b.cookie,data:record,userId:a.body.user.id})).response.status,409);
assert.deepEqual((await request('/api/progress',{cookie:a.cookie})).body.progress,record);
const scopedRecord={...record,selectedSubjectId:'analysis-planning',selectedUnitId:'planning-basics',positions:{'data-information':{lessonId:'l3',questionId:'q5'}}};
assert.equal((await request('/api/progress',{method:'PUT',cookie:b.cookie,data:scopedRecord,userId:b.body.user.id})).response.status,200);
assert.deepEqual((await request('/api/progress',{cookie:b.cookie})).body.progress,scopedRecord);
const db=new DatabaseSync(database);const row=db.prepare('SELECT * FROM users WHERE email=?').get(credentials.email);assert.notEqual(row.password_hash,credentials.password);assert.equal(row.password_hash.length,128);db.close();
await new Promise(resolve=>server.close(resolve));server=createApp({database,sendMail});base=await listen();
assert.equal((await request('/api/me',{cookie:a.cookie})).body.user.email,credentials.email);
assert.deepEqual((await request('/api/progress',{cookie:b.cookie})).body.progress,scopedRecord);
const login=await request('/api/login',{method:'POST',data:credentials,cookie:a.cookie});assert.equal(login.response.status,200);assert.notEqual(login.cookie,a.cookie);
assert.equal((await request('/api/progress',{cookie:a.cookie})).response.status,401);
assert.deepEqual((await request('/api/progress',{cookie:login.cookie})).body.progress,record);
await request('/api/logout',{method:'POST',data:{},cookie:login.cookie});assert.equal((await request('/api/progress',{cookie:login.cookie})).response.status,401);
const expired=await request('/api/login',{method:'POST',data:credentials});const db2=new DatabaseSync(database);db2.prepare('UPDATE sessions SET expires=0').run();db2.close();assert.equal((await request('/api/progress',{cookie:expired.cookie})).response.status,401);
assert.deepEqual((await request('/api/me',{cookie:expired.cookie})).body,{user:null,expired:true});
const live=await post('/api/login',credentials);
const requestReset=()=>post('/api/password/request',{email:credentials.email});
assert.deepEqual((await requestReset()).body,(await post('/api/password/request',{email:'missing@example.test'})).body);
assert.equal(mail.at(-1).kind,'reset');const token=mailToken();
const resetDb=new DatabaseSync(database);
assert.notEqual(resetDb.prepare("SELECT token_hash FROM account_tokens WHERE kind='reset'").get().token_hash,token);
resetDb.prepare("UPDATE account_tokens SET expires=0,created_at=0 WHERE kind='reset'").run();resetDb.close();
const replacement={...credentials,password:'replacement-password-123'};
assert.equal((await post('/api/password/reset',{token,password:replacement.password})).response.status,400);
assert.equal((await requestReset()).response.status,202);const freshToken=mailToken();
assert.equal((await post('/api/password/reset',{token:freshToken,password:replacement.password})).response.status,200);
assert.equal((await post('/api/password/reset',{token:freshToken,password:replacement.password})).response.status,400);
assert.equal((await request('/api/progress',{cookie:live.cookie})).body.code,'SESSION_EXPIRED');
assert.equal((await post('/api/login',credentials)).response.status,401);
const recovered=await post('/api/login',replacement);assert.equal(recovered.response.status,200);
assert.deepEqual((await request('/api/progress',{cookie:recovered.cookie})).body.progress,record);
for(let i=0;i<30;i++)await request('/api/login',{method:'POST',data:{...credentials,password:'wrong-password'}});
assert.equal((await request('/api/login',{method:'POST',data:credentials})).response.status,429);
console.log('PASS: email verification, token expiry and replay rejection, password reset and session revocation, progress preservation, account isolation, CSRF, rate limiting');
}finally{await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
