const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {DatabaseSync,backup}=require('node:sqlite');

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
async function run([action,first,second]){
  try{process.loadEnvFile(path.join(__dirname,'..','.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const database=process.env.DATABASE_PATH||path.join(__dirname,'..','data','study.sqlite');
  if(action==='backup')return snapshot(second||database,first||path.join(path.dirname(database),'backups',`study-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`));
  if(action==='restore'&&first&&second)return snapshot(first,second);
  if(action==='verify'&&first)return {integrity:'ok',counts:verify(first),sha256:await hash(first)};
  throw Error('사용법: database.cjs backup [대상] [원본] | restore <백업> <새 DB> | verify <DB>');
}
if(require.main===module)run(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={snapshot,verify};
