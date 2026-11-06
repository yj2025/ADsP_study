const http = require('node:http');
const https = require('node:https');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { mkdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const {isIP}=require('node:net');
const {mergeProgress}=require('./progress-merge.cjs');
const {removeAccountData}=require('./account-data.cjs');
const derive = promisify(scrypt);
const {setupContent,readContent,importContent}=require('./content-store.cjs');
const {reviewList,publish,reviseQuestion}=require('./review-store.cjs');
const {setupAdmin,prepareUpload,digest}=require('./admin-store.cjs');
const {setupAccountMail,createMailer,issue,readToken,consume}=require('./account-mail.cjs');

function createApp({ database = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'study.sqlite'), tls, secure = Boolean(tls)||process.env.COOKIE_SECURE === '1', origin, sendMail, trustedProxy=process.env.TRUSTED_PROXY_IP } = {}) {
  sendMail??=createMailer({database,origin,secure});
  if (database !== ':memory:') mkdirSync(path.dirname(database), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_id_sequence (singleton INTEGER PRIMARY KEY CHECK(singleton=1), last_id INTEGER NOT NULL);
    INSERT INTO user_id_sequence SELECT 1,COALESCE(MAX(id),0) FROM users WHERE true
      ON CONFLICT(singleton) DO UPDATE SET last_id=MAX(last_id,excluded.last_id);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS progress (user_id INTEGER PRIMARY KEY REFERENCES users(id), payload TEXT NOT NULL);`);
  const limits = new Map();
  setupContent(db);
  setupAdmin(db);
  setupAccountMail(db);
  const dummySalt = randomBytes(16).toString('hex');
  const hashToken = t => createHash('sha256').update(t).digest('hex');
  const cookie = (token, age) => `adsp_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`;
  function json(res, code, data, headers = {}) { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}); res.end(JSON.stringify(data)); }
  async function body(req,maxBytes=16384) {
    const chunks=[];let size=0;
    for await (const chunk of req) {size+=chunk.length;if(size>maxBytes)throw Object.assign(Error('요청이 너무 큽니다.'),{status:413});chunks.push(chunk);}
    const text=Buffer.concat(chunks).toString('utf8');
    try { return JSON.parse(text); } catch { throw Object.assign(Error('올바른 JSON 요청이 필요합니다.'), {status:400}); }
  }
  const sessionTokenFor=req=>/(?:^|;\s*)adsp_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  function user(req) {
    const token = sessionTokenFor(req);
    if (!token) return null;
    return db.prepare('SELECT users.id, users.email, users.role FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>? AND users.verified_at IS NOT NULL').get(hashToken(token), Date.now()) || null;
  }
  function session(req, res, account) {
    const old = /(?:^|;\s*)adsp_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (old) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(old));
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hashToken(token), account.id, Date.now()+7*86400000);
    const publicAccount=db.prepare('SELECT id,email,role FROM users WHERE id=?').get(account.id);
    json(res, 200, {user:publicAccount}, {'Set-Cookie':cookie(token, 7*86400)});
  }
  const protocol=tls?'https':'http';
  const handler=async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if(url.pathname==='/.well-known/assetlinks.json'&&req.method==='GET'){
        const packageName=process.env.ANDROID_PACKAGE_NAME;
        const fingerprint=process.env.ANDROID_CERT_SHA256?.trim().toUpperCase();
        if(!/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(packageName??'')||!/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerprint??'')){
          return json(res,404,{error:'Android 앱 연결 설정이 준비되지 않았습니다.'});
        }
        return json(res,200,[{relation:['delegate_permission/common.handle_all_urls'],target:{
          namespace:'android_app',package_name:packageName,sha256_cert_fingerprints:[fingerprint]
        }}]);
      }
      if (!url.pathname.startsWith('/api/')) {
        const files = {'/':['index.html','text/html'], '/index.html':['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/auth.js':['auth.js','text/javascript'], '/style.css':['style.css','text/css']};
        files['/auth.css']=['auth.css','text/css'];
        files['/curriculum.css']=['curriculum.css','text/css'];
        files['/admin.js']=['admin.js','text/javascript'];files['/admin.css']=['admin.css','text/css'];
        files['/review.js']=['review.js','text/javascript'];
        files['/privacy']=['privacy.html','text/html'];
        files['/account-delete']=['account-delete.html','text/html'];
        files['/account-pages.js']=['account-pages.js','text/javascript'];
        files['/account-pages.css']=['account-pages.css','text/css'];
        files['/manifest.webmanifest']=['manifest.webmanifest','application/manifest+json'];
        files['/icon-192.png']=['icon-192.png','image/png'];
        files['/icon-512.png']=['icon-512.png','image/png'];
        files['/icon-maskable-512.png']=['icon-maskable-512.png','image/png'];
        const file = files[url.pathname];
        if (!file || !['GET','HEAD'].includes(req.method)) return json(res,404,{error:'페이지를 찾을 수 없습니다.'});
        res.writeHead(200, {'Content-Type':file[1]==='image/png'?file[1]:file[1]+'; charset=utf-8','Cache-Control':'no-cache'});
        return res.end(req.method==='HEAD'?undefined:readFileSync(path.join(__dirname,'..','dist',file[0])));
      }
      if (!['GET','POST','PUT'].includes(req.method)) return json(res,405,{error:'지원하지 않는 요청입니다.'});
      if(url.pathname==='/api/content' && req.method==='GET') return json(res,200,readContent(db));
      if(url.pathname==='/api/public-service' && req.method==='GET'){
        const email=process.env.SUPPORT_EMAIL?.trim();
        return json(res,200,{supportEmail:email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null});
      }
      if (req.method !== 'GET') {
        const allowed = origin || `${protocol}://127.0.0.1:${server.address().port}`;
        const allowedLocal = !origin && req.headers.origin === `${protocol}://localhost:${server.address().port}`;
        if ((!allowedLocal && req.headers.origin !== allowed) || !req.headers['content-type']?.startsWith('application/json')) return json(res,403,{error:'허용되지 않은 요청입니다.'});
      }
      if (url.pathname==='/api/me' && req.method==='GET') {
        const account=user(req),expired=!account&&Boolean(sessionTokenFor(req));
        return json(res,200,{user:account,...(expired?{expired:true}:{})},expired?{'Set-Cookie':cookie('',0)}:{});
      }
      if (['/api/register','/api/login','/api/email/resend','/api/email/verify','/api/password/request','/api/password/reset'].includes(url.pathname) && req.method==='POST') {
        const peer=req.socket.remoteAddress?.replace(/^::ffff:/,'');
        const forwarded=req.headers['x-study-client-ip'];
        const address=peer===trustedProxy&&typeof forwarded==='string'&&isIP(forwarded)?forwarded.replace(/^::ffff:/,''):peer;
        const now = Date.now();
        for (const [key, entry] of limits) if (entry.until < now) limits.delete(key);
        const entry=limits.get(address)||{count:0,until:now+15*60000};
        if (++entry.count > 30) return json(res,429,{error:'시도가 너무 많습니다. 15분 후 다시 시도해 주세요.'});
        limits.set(address,entry);
        const data=await body(req);
        const email=typeof data?.email==='string'?data.email.trim().toLowerCase():'';
        const password=data?.password;
        const validEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=254;
        const validPassword=typeof password==='string'&&password.length>=10&&password.length<=128;
        const mailOrigin=origin||`${protocol}://127.0.0.1:${server.address().port}`;
        if(['/api/email/resend','/api/password/request'].includes(url.pathname)){
          if(!validEmail)return json(res,400,{error:'올바른 이메일을 입력해 주세요.'});
          const kind=url.pathname==='/api/email/resend'?'verify':'reset';
          const target=db.prepare('SELECT id,email,verified_at FROM users WHERE email=?').get(email);
          // Give the same response regardless of account existence or delivery outcome.
          if(target&&(kind==='reset'||!target.verified_at))issue(db,sendMail,target,kind,mailOrigin).catch(()=>console.error('계정 이메일 발송 실패'));
          return json(res,202,{ok:true});
        }
        if(['/api/email/verify','/api/password/reset'].includes(url.pathname)){
          if(!validPassword)return json(res,400,{error:'10~128자 비밀번호를 입력해 주세요.'});
          const kind=url.pathname==='/api/email/verify'?'verify':'reset',target=readToken(db,data?.token,kind);
          if(kind==='verify'){
            const hashed=await derive(password,target.salt,64);
            if(!timingSafeEqual(hashed,Buffer.from(target.password_hash,'hex')))return json(res,401,{error:'가입할 때 입력한 비밀번호가 일치하지 않습니다.'});
            consume(db,data.token,kind,row=>db.prepare('UPDATE users SET verified_at=? WHERE id=?').run(Date.now(),row.id));
          }else{
            const salt=randomBytes(16).toString('hex'),hashed=await derive(password,salt,64);
            consume(db,data.token,kind,row=>{
              db.prepare('UPDATE users SET salt=?,password_hash=?,verified_at=COALESCE(verified_at,?) WHERE id=?').run(salt,hashed.toString('hex'),Date.now(),row.id);
              db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
              db.prepare('DELETE FROM account_tokens WHERE user_id=?').run(row.id);
            });
          }
          return json(res,200,{ok:true});
        }
        if(!validEmail||!validPassword)return json(res,400,{error:'이메일과 10~128자 비밀번호를 입력해 주세요.'});
        const account=db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if(url.pathname==='/api/register') {
          const salt=randomBytes(16).toString('hex');
          const hashed=await derive(password,salt,64);
          if(account) return json(res,409,{error:'이 이메일로 가입할 수 없습니다. 로그인 정보를 확인해 주세요.'});
          try {
            const {last_id:id}=db.prepare('UPDATE user_id_sequence SET last_id=MAX(last_id,(SELECT COALESCE(MAX(id),0) FROM users))+1 RETURNING last_id').get();
            db.prepare('INSERT INTO users(id,email,salt,password_hash) VALUES (?,?,?,?)').run(id,email,salt,hashed.toString('hex'));
            let delivery=true;try{await issue(db,sendMail,{id,email},'verify',mailOrigin);}catch{delivery=false;}
            return json(res,202,{verificationRequired:true,delivery});}
          catch(error){if(error.code==='ERR_SQLITE_ERROR' && /UNIQUE/.test(error.message))return json(res,409,{error:'이 이메일로 가입할 수 없습니다.'});throw error;}
        }
        const hashed=await derive(password,account?.salt||dummySalt,64);
        if (!account || !timingSafeEqual(hashed,Buffer.from(account.password_hash,'hex'))) return json(res,401,{error:'이메일 또는 비밀번호가 일치하지 않습니다.'});
        const current=db.prepare('SELECT verified_at,password_hash FROM users WHERE id=?').get(account.id);
        if(current?.password_hash!==account.password_hash)return json(res,401,{error:'로그인 정보를 다시 확인해 주세요.'});
        if(!current.verified_at)return json(res,403,{code:'EMAIL_UNVERIFIED',error:'이메일을 인증한 후 로그인해 주세요.'});
        return session(req,res,account);
      }
      const account=user(req);
      if (!account) return json(res,401,{code:'SESSION_EXPIRED',error:'세션이 만료되었습니다. 다시 로그인해 주세요.'});
      if(url.pathname.startsWith('/api/admin/')){
        const currentAdmin=()=>user(req)?.role==='admin';
        if(!currentAdmin())return json(res,403,{error:'관리자만 콘텐츠를 관리할 수 있습니다.'});
        if(req.method!=='GET'&&req.headers['x-study-user']!==String(account.id))return json(res,409,{error:'로그인 계정이 변경되었습니다. 새로고침해 주세요.'});
        const sessionToken=/(?:^|;\s*)adsp_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];
        if(url.pathname==='/api/admin/content/review'&&req.method==='GET')return json(res,200,reviewList(db,url.searchParams.get('unit_id'),url.searchParams.get('status')??'draft'));
        if(url.pathname==='/api/admin/content/publish'&&req.method==='POST')return json(res,200,{counts:publish(db,await body(req,128*1024),account.id,currentAdmin)});
        if(url.pathname==='/api/admin/content/question'&&req.method==='POST')return json(res,200,reviseQuestion(db,await body(req,128*1024),currentAdmin));
        if(url.pathname==='/api/admin/content/validate'&&req.method==='POST'){
          const input=await body(req,12*1024*1024);
          if(!currentAdmin())return json(res,403,{error:'관리자 권한이 변경되었습니다.'});
          db.prepare('DELETE FROM content_uploads WHERE expires<=? OR user_id=?').run(Date.now(),account.id);
          try{
            const prepared=prepareUpload(db,input),token=randomBytes(32).toString('hex');
            const expires=Date.now()+10*60000;
            db.prepare('INSERT INTO content_uploads VALUES (?,?,?,?,?,?,?)').run(digest(token),account.id,digest(sessionToken),input.filename,prepared.unit.id,JSON.stringify(prepared.bundle),expires);
            return json(res,200,{valid:true,validation_token:token,expires_at:expires,counts:prepared.counts,unit:prepared.unit,warnings:prepared.warnings,preview:prepared.preview});
          }catch(error){return json(res,error.status||422,{valid:false,errors:[error.message],error:error.message});}
        }
        if(url.pathname==='/api/admin/content/import'&&req.method==='POST'){
          const input=await body(req);
          if(!currentAdmin())return json(res,403,{error:'관리자 권한이 변경되었습니다.'});
          if(typeof input?.validation_token!=='string'||!/^[a-f0-9]{64}$/.test(input.validation_token))return json(res,400,{error:'먼저 파일을 검증해 주세요.'});
          const staged=db.prepare('SELECT * FROM content_uploads WHERE token_hash=? AND user_id=? AND session_hash=? AND expires>?').get(digest(input.validation_token),account.id,digest(sessionToken),Date.now());
          if(!staged)return json(res,409,{error:'검증 결과가 만료되었거나 이미 사용되었습니다. 다시 검증해 주세요.'});
          const bundle=JSON.parse(staged.bundle);
          try{
            const counts=importContent(db,bundle,{reviewStatus:'draft',afterInsert:counts=>{
              if(!currentAdmin())throw Object.assign(Error('관리자 권한이 변경되었습니다.'),{status:403});
              db.prepare('DELETE FROM content_uploads WHERE token_hash=?').run(staged.token_hash);
              db.prepare('INSERT INTO content_imports(user_id,filename,unit_id,counts,created_at) VALUES (?,?,?,?,?)').run(account.id,staged.filename,staged.unit_id,JSON.stringify(counts),Date.now());
            }});
            return json(res,200,{ok:true,status:'draft',counts,unit_id:staged.unit_id});
          }catch(error){return json(res,error.status||409,{error:`저장하지 못했습니다. ${error.message} 다시 검증해 주세요.`});}
        }
        return json(res,404,{error:'관리자 요청을 찾을 수 없습니다.'});
      }
      if(url.pathname==='/api/logout' && req.method==='POST') {
        const token=/(?:^|;\s*)adsp_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
        return json(res,200,{ok:true},{'Set-Cookie':cookie('',0)});
      }
      if(url.pathname==='/api/account/delete' && req.method==='POST'){
        if(req.headers['x-study-user']!==String(account.id))return json(res,409,{error:'로그인 계정이 변경되었습니다. 페이지를 다시 열어 주세요.'});
        const input=await body(req);
        const password=input?.password;
        if(input?.confirmed!==true||typeof password!=='string'||password.length<10||password.length>128){
          return json(res,400,{error:'현재 비밀번호를 입력하고 삭제에 동의해 주세요.'});
        }
        const now=Date.now(),key=`delete:${account.id}`;
        for(const [id,entry] of limits)if(entry.until<=now)limits.delete(id);
        const limit=limits.get(key)??{count:0,until:now+15*60000};
        if(limit.count>=5)return json(res,429,{error:'시도가 너무 많습니다. 15분 후 다시 시도해 주세요.'});
        limit.count++;limits.set(key,limit);
        const row=db.prepare('SELECT salt,password_hash FROM users WHERE id=?').get(account.id);
        if(!row||user(req)?.id!==account.id)return json(res,401,{code:'SESSION_EXPIRED',error:'다시 로그인해 주세요.'});
        const hashed=await derive(password,row.salt,64);
        if(!timingSafeEqual(hashed,Buffer.from(row.password_hash,'hex')))return json(res,403,{error:'현재 비밀번호가 일치하지 않습니다.'});
        db.exec('BEGIN IMMEDIATE');
        try{
          const current=db.prepare('SELECT password_hash FROM users WHERE id=?').get(account.id);
          if(user(req)?.id!==account.id||current?.password_hash!==row.password_hash){
            db.exec('ROLLBACK');
            return json(res,401,{code:'SESSION_EXPIRED',error:'다시 로그인해 주세요.'});
          }
          removeAccountData(db,account.id);
          db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');throw error;}
        limits.delete(key);
        return json(res,200,{ok:true},{'Set-Cookie':cookie('',0)});
      }
      if(url.pathname==='/api/progress' && req.method==='GET') {
        const row=db.prepare('SELECT payload FROM progress WHERE user_id=?').get(account.id);
        return json(res,200,{progress:row?JSON.parse(row.payload):null});
      }
      if(url.pathname==='/api/progress' && req.method==='PUT') {
        if(req.headers['x-study-user']!==String(account.id)) return json(res,409,{error:'다른 탭에서 계정이 변경되었습니다. 새로고침 후 다시 학습해 주세요.'});
        const data=await body(req,1024*1024);
        if(user(req)?.id!==account.id)return json(res,401,{code:'SESSION_EXPIRED',error:'세션이 만료되었습니다. 다시 로그인해 주세요.'});
        const wrapped=data&&Object.hasOwn(data,'base');
        const next=wrapped?data.progress:data;
        const valid=value=>value?.version===1&&Array.isArray(value.completed)&&value.answers&&typeof value.answers==='object'&&!Array.isArray(value.answers);
        if(!valid(next)||(wrapped&&data.base!==null&&data.base?.version!==1))return json(res,400,{error:'학습 기록 형식이 올바르지 않습니다.'});
        db.exec('BEGIN IMMEDIATE');
        try{
          const row=db.prepare('SELECT payload FROM progress WHERE user_id=?').get(account.id);
          if(row&&!wrapped)throw Object.assign(Error('최신 학습 기록을 불러온 뒤 저장해 주세요.'),{status:409,code:'PROGRESS_CONFLICT'});
          const merged=mergeProgress(wrapped?data.base:null,next,row?JSON.parse(row.payload):null);
          db.prepare('INSERT INTO progress VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload').run(account.id,JSON.stringify(merged));
          db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');throw error;}
        return json(res,200,{ok:true});
      }
      return json(res,404,{error:'요청을 찾을 수 없습니다.'});
    } catch(error) { if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'요청을 처리하지 못했습니다. 다시 시도해 주세요.',...(error.status===409&&error.code?{code:error.code}:{})}); else res.end(); }
  };
  const server=tls?https.createServer(tls,handler):http.createServer(handler);
  server.on('close',()=>db.close());
  return server;
}
if(require.main===module){
  try{process.loadEnvFile(path.join(__dirname,'..','.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const localTls=process.argv.includes('--https-local');
  const port=Number(process.env.PORT)||(localTls?4443:4173),host=localTls?'127.0.0.1':process.env.BIND_HOST||'127.0.0.1';
  const tlsFolder=path.join(__dirname,'..','data','tls');
  const cert=process.env.TLS_CERT_FILE||(localTls?path.join(tlsFolder,'local.crt'):null);
  const key=process.env.TLS_KEY_FILE||(localTls?path.join(tlsFolder,'local.key'):null);
  const origin=localTls?`https://127.0.0.1:${port}`:process.env.APP_ORIGIN;
  if(localTls&&!process.env.MAIL_MODE)process.env.MAIL_MODE='local';
  if(Boolean(cert)!==Boolean(key))throw Error('TLS_CERT_FILE과 TLS_KEY_FILE을 함께 지정하세요.');
  const tls=cert?{cert:readFileSync(cert),key:readFileSync(key),minVersion:'TLSv1.2'}:undefined;
  const app=createApp({tls,origin});
  app.listen(port,host,()=>console.log(`ADsP Study Room: ${tls?'https':'http'}://${host}:${port}`));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close());
}
module.exports={createApp};
