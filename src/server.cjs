const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { mkdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const derive = promisify(scrypt);
const {setupContent,readContent,importContent}=require('./content-store.cjs');
const {reviewList,publish}=require('./review-store.cjs');
const {setupAdmin,prepareUpload,digest}=require('./admin-store.cjs');

function createApp({ database = path.join(__dirname, '..', 'data', 'study.sqlite'), secure = process.env.COOKIE_SECURE === '1', origin } = {}) {
  if (database !== ':memory:') mkdirSync(path.dirname(database), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS progress (user_id INTEGER PRIMARY KEY REFERENCES users(id), payload TEXT NOT NULL);`);
  const limits = new Map();
  setupContent(db);
  setupAdmin(db);
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
  function user(req) {
    const token = /(?:^|;\s*)adsp_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (!token) return null;
    return db.prepare('SELECT users.id, users.email, users.role FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>?').get(hashToken(token), Date.now()) || null;
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
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        const files = {'/':['index.html','text/html'], '/index.html':['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/auth.js':['auth.js','text/javascript'], '/style.css':['style.css','text/css']};
        files['/auth.css']=['auth.css','text/css'];
        files['/curriculum.css']=['curriculum.css','text/css'];
        files['/admin.js']=['admin.js','text/javascript'];files['/admin.css']=['admin.css','text/css'];
        files['/review.js']=['review.js','text/javascript'];
        const file = files[url.pathname];
        if (!file || !['GET','HEAD'].includes(req.method)) return json(res,404,{error:'페이지를 찾을 수 없습니다.'});
        res.writeHead(200, {'Content-Type':file[1]+'; charset=utf-8','Cache-Control':'no-cache'});
        return res.end(req.method==='HEAD'?undefined:readFileSync(path.join(__dirname,'..','dist',file[0])));
      }
      if (!['GET','POST','PUT'].includes(req.method)) return json(res,405,{error:'지원하지 않는 요청입니다.'});
      if(url.pathname==='/api/content' && req.method==='GET') return json(res,200,readContent(db));
      if (req.method !== 'GET') {
        const allowed = origin || `http://127.0.0.1:${server.address().port}`;
        const allowedLocal = !origin && req.headers.origin === `http://localhost:${server.address().port}`;
        if ((!allowedLocal && req.headers.origin !== allowed) || !req.headers['content-type']?.startsWith('application/json')) return json(res,403,{error:'허용되지 않은 요청입니다.'});
      }
      if (url.pathname==='/api/me' && req.method==='GET') return json(res,200,{user:user(req)});
      if (['/api/register','/api/login'].includes(url.pathname) && req.method==='POST') {
        const address = req.socket.remoteAddress;
        const now = Date.now();
        for (const [key, entry] of limits) if (entry.until < now) limits.delete(key);
        const entry=limits.get(address)||{count:0,until:now+15*60000};
        if (++entry.count > 30) return json(res,429,{error:'시도가 너무 많습니다. 15분 후 다시 시도해 주세요.'});
        limits.set(address,entry);
        const data=await body(req);
        const email=typeof data?.email==='string'?data.email.trim().toLowerCase():'';
        const password=data?.password;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || typeof password!=='string' || password.length<10 || password.length>128) return json(res,400,{error:'이메일과 10~128자 비밀번호를 입력해 주세요.'});
        const account=db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if(url.pathname==='/api/register') {
          const salt=randomBytes(16).toString('hex');
          const hashed=await derive(password,salt,64);
          if(account) return json(res,409,{error:'이 이메일로 가입할 수 없습니다. 로그인 정보를 확인해 주세요.'});
          try {const result=db.prepare('INSERT INTO users(email,salt,password_hash) VALUES (?,?,?)').run(email,salt,hashed.toString('hex')); return session(req,res,{id:Number(result.lastInsertRowid),email});}
          catch(error){if(error.code==='ERR_SQLITE_ERROR' && /UNIQUE/.test(error.message))return json(res,409,{error:'이 이메일로 가입할 수 없습니다.'});throw error;}
        }
        const hashed=await derive(password,account?.salt||dummySalt,64);
        if (!account || !timingSafeEqual(hashed,Buffer.from(account.password_hash,'hex'))) return json(res,401,{error:'이메일 또는 비밀번호가 일치하지 않습니다.'});
        return session(req,res,account);
      }
      const account=user(req);
      if (!account) return json(res,401,{error:'로그인이 필요합니다.'});
      if(url.pathname.startsWith('/api/admin/')){
        const currentAdmin=()=>user(req)?.role==='admin';
        if(!currentAdmin())return json(res,403,{error:'관리자만 콘텐츠를 관리할 수 있습니다.'});
        if(req.method!=='GET'&&req.headers['x-study-user']!==String(account.id))return json(res,409,{error:'로그인 계정이 변경되었습니다. 새로고침해 주세요.'});
        const sessionToken=/(?:^|;\s*)adsp_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];
        if(url.pathname==='/api/admin/content/review'&&req.method==='GET')return json(res,200,reviewList(db,url.searchParams.get('unit_id'),url.searchParams.get('status')??'draft'));
        if(url.pathname==='/api/admin/content/publish'&&req.method==='POST')return json(res,200,{counts:publish(db,await body(req,128*1024),account.id,currentAdmin)});
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
      if(url.pathname==='/api/progress' && req.method==='GET') {
        const row=db.prepare('SELECT payload FROM progress WHERE user_id=?').get(account.id);
        return json(res,200,{progress:row?JSON.parse(row.payload):null});
      }
      if(url.pathname==='/api/progress' && req.method==='PUT') {
        if(req.headers['x-study-user']!==String(account.id)) return json(res,409,{error:'다른 탭에서 계정이 변경되었습니다. 새로고침 후 다시 학습해 주세요.'});
        const data=await body(req,1024*1024);
        if (!data || data.version!==1 || !Array.isArray(data.completed) || !data.answers || typeof data.answers!=='object' || Array.isArray(data.answers)) return json(res,400,{error:'학습 기록 형식이 올바르지 않습니다.'});
        db.prepare('INSERT INTO progress VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload').run(account.id,JSON.stringify(data));
        return json(res,200,{ok:true});
      }
      return json(res,404,{error:'요청을 찾을 수 없습니다.'});
    } catch(error) { if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'요청을 처리하지 못했습니다. 다시 시도해 주세요.'}); else res.end(); }
  });
  server.on('close',()=>db.close());
  return server;
}
if(require.main===module){const port=Number(process.env.PORT)||4173;createApp({origin:process.env.APP_ORIGIN}).listen(port,'127.0.0.1',()=>console.log(`ADsP Study Room: http://127.0.0.1:${port}`));}
module.exports={createApp};
