const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {DatabaseSync,backup}=require('node:sqlite');
const {removeAccountData}=require('../src/account-data.cjs');

function verify(filename){
  const db=new DatabaseSync(filename,{readOnly:true});
  try{
    if(db.prepare('PRAGMA integrity_check').all().some(row=>row.integrity_check!=='ok')||db.prepare('PRAGMA foreign_key_check').get())throw Error('SQLite 무결성 검사 실패');
    return Object.fromEntries(['users','progress','content_lessons','content_questions'].map(table=>[table,db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
  }finally{db.close();}
}
async function hash(filename){
  const digest=createHash('sha256');for await(const chunk of fs.createReadStream(filename))digest.update(chunk);return digest.digest('hex');
}
async function snapshot(source,target){
  source=path.resolve(source);target=path.resolve(target);
  if(!fs.statSync(source).isFile())throw Error('원본 DB 파일이 필요합니다.');
  if(['','-wal','-shm','-journal'].some(suffix=>fs.existsSync(target+suffix)))throw Error('대상 DB 또는 보조 파일이 이미 있습니다. 새 경로를 지정하세요.');
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  const tmp=fs.mkdtempSync(path.join(path.dirname(target),'.sqlite-copy-'));
  const file=path.join(tmp,'snapshot.sqlite');
  try{
    const db=new DatabaseSync(source,{readOnly:true,timeout:5000});
    try{await backup(db,file);}finally{db.close();}
    const copy=new DatabaseSync(file);try{copy.exec('PRAGMA journal_mode=DELETE');}finally{copy.close();}
    fs.chmodSync(file,0o600);
    const counts=verify(file),sha256=await hash(file);
    // Copy only after validation, without replacing an existing file.
    fs.copyFileSync(file,target,fs.constants.COPYFILE_EXCL);
    return {path:target,integrity:'ok',counts,sha256};
  }finally{
    for(const suffix of ['','-wal','-shm','-journal'])if(fs.existsSync(file+suffix))fs.unlinkSync(file+suffix);
    fs.rmdirSync(tmp);
  }
}
async function restoreForService(source,target,accountState){
  // The current, trusted account state must be separate from the historical backup.
  const canonical=file=>fs.realpathSync(file);
  if(canonical(source)===canonical(accountState))throw Error('백업과 별도의 신뢰할 수 있는 최신 계정 DB가 필요합니다.');
  const current=new DatabaseSync(accountState,{readOnly:true});
  let users,lastId;
  try{
    current.exec('BEGIN');
    users=new Map(current.prepare('SELECT id,email,salt,password_hash,verified_at,role FROM users').all().map(row=>[row.id,row]));
    lastId=current.prepare('SELECT last_id FROM user_id_sequence WHERE singleton=1').get()?.last_id;
    if(!Number.isSafeInteger(lastId))throw Error('최신 계정 DB의 계정 ID 순번을 확인할 수 없습니다.');
  }finally{current.close();}
  target=path.resolve(target);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const tmp=fs.mkdtempSync(path.join(path.dirname(target),'.restore-for-service-'));
  const staged=path.join(tmp,'staged.sqlite');
  try{
    await snapshot(source,staged);
    const db=new DatabaseSync(staged);
    let removed=0;
    try{
      db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
      db.exec('DELETE FROM sessions; DELETE FROM account_tokens; DELETE FROM content_uploads;');
      for(const row of db.prepare('SELECT id,email FROM users').all()){
        const latest=users.get(row.id);
        if(!latest||latest.email!==row.email){removed+=removeAccountData(db,row.id);continue;}
        db.prepare('UPDATE users SET salt=?,password_hash=?,verified_at=?,role=? WHERE id=?')
          .run(latest.salt,latest.password_hash,latest.verified_at,latest.role,row.id);
      }
      const insert=db.prepare('INSERT INTO users(id,email,salt,password_hash,verified_at,role) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING');
      for(const user of users.values())insert.run(user.id,user.email,user.salt,user.password_hash,user.verified_at,user.role);
      db.exec('CREATE TABLE IF NOT EXISTS user_id_sequence (singleton INTEGER PRIMARY KEY CHECK(singleton=1), last_id INTEGER NOT NULL)');
      db.prepare('INSERT INTO user_id_sequence VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET last_id=MAX(last_id,excluded.last_id)').run(lastId);
      db.exec('COMMIT');
    }finally{db.close();}
    return {...await snapshot(staged,target),removed};
  }finally{if(fs.existsSync(staged))fs.unlinkSync(staged);fs.rmdirSync(tmp);}
}
async function run([action,first,second,third]){
  try{process.loadEnvFile(path.join(__dirname,'..','.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const database=process.env.DATABASE_PATH||path.join(__dirname,'..','data','study.sqlite');
  if(action==='backup')return snapshot(second||database,first||path.join(path.dirname(database),'backups',`study-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`));
  if(action==='restore'&&first&&second)return snapshot(first,second);
  if(action==='restore-for-service'&&first&&second&&third)return restoreForService(first,second,third);
  if(action==='verify'&&first)return {integrity:'ok',counts:verify(first),sha256:await hash(first)};
  throw Error('사용법: database.cjs backup [대상] [원본] | restore <백업> <새 DB> | restore-for-service <백업> <새 DB> <최신 계정 DB> | verify <DB>');
}
if(require.main===module)run(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={snapshot,verify,restoreForService};
