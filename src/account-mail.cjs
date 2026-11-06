const {randomBytes,createHash}=require('node:crypto');
const {mkdir,writeFile}=require('node:fs/promises');
const path=require('node:path');
const hash=token=>createHash('sha256').update(token).digest('hex');
const fail=(status,message)=>Object.assign(Error(message),{status});

function setupAccountMail(db){
  db.exec('BEGIN IMMEDIATE');
  try{
    if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='verified_at')){
      db.exec('ALTER TABLE users ADD COLUMN verified_at INTEGER');
      db.prepare('UPDATE users SET verified_at=?').run(Date.now());
    }
    db.exec(`CREATE TABLE IF NOT EXISTS account_tokens (
      token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL,
      created_at INTEGER NOT NULL,expires INTEGER NOT NULL,UNIQUE(user_id,kind));`);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
function createMailer({database,origin,secure}){
  const mode=process.env.MAIL_MODE??(origin||secure?'disabled':'local');
  if(mode==='webhook'){
    const endpoint=new URL(process.env.MAIL_WEBHOOK_URL);
    const secret=process.env.MAIL_WEBHOOK_TOKEN;
    if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||!secret||!origin||new URL(origin).protocol!=='https:')throw Error('Webhook 발송에는 HTTPS APP_ORIGIN, MAIL_WEBHOOK_URL, MAIL_WEBHOOK_TOKEN이 필요합니다.');
    return async message=>{
      const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`},body:JSON.stringify(message)});
      if(!response.ok)throw Error('메일 발송 서비스가 요청을 거절했습니다.');
    };
  }
  if(mode==='local'&&(!origin||['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname))&&database!==':memory:'){
    const folder=path.join(path.dirname(database),'mail-outbox');
    return async message=>{
      await mkdir(folder,{recursive:true,mode:0o700});
      await writeFile(path.join(folder,`${Date.now()}-${randomBytes(8).toString('hex')}.json`),JSON.stringify(message,null,2),{flag:'wx',mode:0o600});
    };
  }
  return async()=>{throw Error('메일 발송이 설정되지 않았습니다.');};
}
async function issue(db,sendMail,account,kind,origin){
  const now=Date.now();
  if(db.prepare('SELECT 1 FROM account_tokens WHERE user_id=? AND kind=? AND created_at>?').get(account.id,kind,now-60000))return;
  db.prepare('DELETE FROM account_tokens WHERE expires<=?').run(now);
  const token=randomBytes(32).toString('hex'),digest=hash(token),minutes=kind==='verify'?60:30;
  db.prepare('INSERT INTO account_tokens VALUES (?,?,?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at,expires=excluded.expires').run(digest,account.id,kind,now,now+minutes*60000);
  const link=new URL('/',origin);link.hash=`${kind}=${token}`;
  const subject=kind==='verify'?'ADsP 스터디룸 이메일 인증':'ADsP 스터디룸 비밀번호 재설정';
  try{await sendMail({to:account.email,subject,text:`${subject}\n${link.href}\n이 링크는 ${minutes}분 동안 한 번만 사용할 수 있습니다. 요청하지 않았다면 무시하세요.`,kind,link:link.href});}
  catch(error){db.prepare('DELETE FROM account_tokens WHERE token_hash=?').run(digest);throw error;}
}
function readToken(db,token,kind){
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw fail(400,'유효하지 않은 링크입니다. 새 링크를 요청해 주세요.');
  const row=db.prepare('SELECT users.*,account_tokens.token_hash FROM account_tokens JOIN users ON users.id=account_tokens.user_id WHERE token_hash=? AND kind=? AND expires>?').get(hash(token),kind,Date.now());
  if(!row)throw fail(400,'링크가 만료되었거나 이미 사용되었습니다. 새 링크를 요청해 주세요.');
  return row;
}
function consume(db,token,kind,apply){
  db.exec('BEGIN IMMEDIATE');
  try{const row=readToken(db,token,kind);apply(row);db.prepare('DELETE FROM account_tokens WHERE token_hash=?').run(row.token_hash);db.exec('COMMIT');return row;}
  catch(error){db.exec('ROLLBACK');throw error;}
}
module.exports={setupAccountMail,createMailer,issue,readToken,consume};
