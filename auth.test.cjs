const {createApp}=require('./server.cjs');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {mkdtempSync,rmSync}=require('node:fs');
const path=require('node:path');
const os=require('node:os');
(async()=>{
const directory=mkdtempSync(path.join(os.tmpdir(),'adsp-auth-'));
const database=path.join(directory,'test.sqlite');
let server=createApp({database});
async function listen(){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;}
let base=await listen();
async function request(route,{method='GET',data,cookie,origin=base,userId}={}){const response=await fetch(base+route,{method,headers:{...(method!=='GET'?{'Content-Type':'application/json',Origin:origin}:{}),...(cookie?{Cookie:cookie}:{}),...(userId?{'X-Study-User':String(userId)}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {response,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
const credentials={email:'student@example.test',password:'test-password-123'};
try{
const initial=await request('/api/content');assert.equal(initial.response.status,200);assert.equal(initial.body.lessons.length,3);assert.equal(initial.body.questions.length,6);
const contentDB=new DatabaseSync(database);const {importContent}=require('./content-store.cjs');importContent(contentDB,JSON.parse(require('node:fs').readFileSync('content/example.json','utf8')));contentDB.close();
const expanded=await request('/api/content');assert.equal(expanded.body.lessons.length,4);assert.equal(expanded.body.questions[6].lesson_id,'data-quality');assert.equal(expanded.body.questions[6].lesson,3);
assert.equal((await request('/api/progress')).response.status,401);
assert.equal((await request('/api/register',{method:'POST',data:credentials,origin:'https://evil.test'})).response.status,403);
assert.equal((await request('/api/register',{method:'POST',data:{email:'x',password:'short'}})).response.status,400);
const a=await request('/api/register',{method:'POST',data:credentials});assert.equal(a.response.status,200);assert.match(a.response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.equal(a.body.user.email,credentials.email);
assert.equal((await request('/api/register',{method:'POST',data:credentials})).response.status,409);
assert.equal((await request('/api/login',{method:'POST',data:{...credentials,password:'wrong-password'}})).response.status,401);
const record={version:1,completed:[0,1],answers:{q1:2},lesson:2,wrong:[],resolved:[],quizIndex:1};
assert.equal((await request('/api/progress',{method:'PUT',cookie:a.cookie,data:record,userId:a.body.user.id})).response.status,200);
const b=await request('/api/register',{method:'POST',data:{...credentials,email:'other@example.test'}});
assert.equal((await request('/api/progress',{cookie:b.cookie})).body.progress,null);
assert.equal((await request('/api/progress',{method:'PUT',cookie:b.cookie,data:record,userId:a.body.user.id})).response.status,409);
assert.deepEqual((await request('/api/progress',{cookie:a.cookie})).body.progress,record);
const db=new DatabaseSync(database);const row=db.prepare('SELECT * FROM users WHERE email=?').get(credentials.email);assert.notEqual(row.password_hash,credentials.password);assert.equal(row.password_hash.length,128);db.close();
await new Promise(resolve=>server.close(resolve));server=createApp({database});base=await listen();
assert.equal((await request('/api/me',{cookie:a.cookie})).body.user.email,credentials.email);
const login=await request('/api/login',{method:'POST',data:credentials,cookie:a.cookie});assert.equal(login.response.status,200);assert.notEqual(login.cookie,a.cookie);
assert.equal((await request('/api/progress',{cookie:a.cookie})).response.status,401);
assert.deepEqual((await request('/api/progress',{cookie:login.cookie})).body.progress,record);
await request('/api/logout',{method:'POST',data:{},cookie:login.cookie});assert.equal((await request('/api/progress',{cookie:login.cookie})).response.status,401);
const expired=await request('/api/login',{method:'POST',data:credentials});const db2=new DatabaseSync(database);db2.prepare('UPDATE sessions SET expires=0').run();db2.close();assert.equal((await request('/api/progress',{cookie:expired.cookie})).response.status,401);
for(let i=0;i<30;i++)await request('/api/login',{method:'POST',data:{...credentials,password:'wrong-password'}});
assert.equal((await request('/api/login',{method:'POST',data:credentials})).response.status,429);
console.log('PASS: signup, validation, duplicate account, password hashing, wrong password, account isolation, persistence across restart, session rotation, logout, expiry, CSRF, rate limiting');
}finally{await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
