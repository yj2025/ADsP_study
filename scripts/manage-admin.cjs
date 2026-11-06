const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {setupAdmin}=require('../src/admin-store.cjs');
function run(args){
  if(!args.length||args[0]==='--help'){console.log('사용법: node scripts/manage-admin.cjs <grant|revoke> <가입 이메일> [--database <DB 경로>]');return;}
  const action=args.shift(),email=(args.shift()??'').trim().toLowerCase();
  if(!['grant','revoke'].includes(action)||!email)throw Error('grant 또는 revoke와 기존 가입 이메일을 지정하세요.');
  let filename=path.join(__dirname,'..','data','study.sqlite');
  if(args.length){if(args.length!==2||args[0]!=='--database')throw Error('올바르지 않은 옵션입니다.');filename=path.resolve(args[1]);}
  if(!fs.existsSync(filename))throw Error('DB가 없습니다. 서버를 실행하고 계정을 먼저 가입해 주세요.');
  const db=new DatabaseSync(filename);try{
    setupAdmin(db);const user=db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if(!user)throw Error('해당 이메일의 가입 계정을 찾을 수 없습니다.');
    const role=action==='grant'?'admin':'member';db.prepare('UPDATE users SET role=? WHERE id=?').run(role,user.id);
    if(role==='member')db.prepare('DELETE FROM content_uploads WHERE user_id=?').run(user.id);
    console.log(JSON.stringify({email,role}));
  }finally{db.close();}
}
if(require.main===module){try{run(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={run};
