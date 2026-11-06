const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createApp}=require('../src/server.cjs');
const {snapshot,verify,restoreForService}=require('../scripts/database.cjs');
const {removeAccountData}=require('../src/account-data.cjs');

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'adsp-db-test-'));
  const source=path.join(dir,'study.sqlite'),copy=path.join(dir,'backup.sqlite'),restored=path.join(dir,'restored.sqlite');
  const app=createApp({database:source,sendMail:async()=>{}});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const writer=new DatabaseSync(source);
  try{
    writer.exec('PRAGMA wal_autocheckpoint=0');
    writer.prepare('INSERT INTO users(email,salt,password_hash) VALUES (?,?,?)').run('backup-test@example.test','test-salt','test-hash');
    writer.prepare('INSERT INTO progress VALUES (?,?)').run(1,'{"version":1,"completed":[1]}');
    writer.exec("INSERT INTO users(id,email,salt,password_hash) VALUES (2,'deleted@example.test','salt','hash'); UPDATE user_id_sequence SET last_id=2;");
    writer.prepare('INSERT INTO sessions VALUES (?,?,?)').run('old-session',1,Date.now()+60000);
    writer.prepare('INSERT INTO account_tokens VALUES (?,?,?,?,?)').run('old-token',1,'reset',Date.now(),Date.now()+60000);
    assert.ok(fs.statSync(source+'-wal').size>32);
    assert.equal((await snapshot(source,copy)).counts.progress,1);
    assert.deepEqual((await snapshot(copy,restored)).counts,verify(copy));
    await assert.rejects(snapshot(source,restored),/이미 있습니다/);
    const db=new DatabaseSync(restored,{readOnly:true});
    try{
      assert.equal(db.prepare('SELECT email FROM users').get().email,'backup-test@example.test');
      assert.equal(db.prepare('SELECT payload FROM progress').get().payload,'{"version":1,"completed":[1]}');
    }finally{db.close();}
    const restarted=createApp({database:restored,sendMail:async()=>{}});
    await new Promise(resolve=>restarted.listen(0,'127.0.0.1',resolve));
    try{
      const response=await fetch(`http://127.0.0.1:${restarted.address().port}/api/content`);
      assert.equal(response.status,200);assert.equal((await response.json()).questions.length,6);
    }finally{await new Promise(resolve=>restarted.close(resolve));}
    writer.exec('BEGIN');
    removeAccountData(writer,2);
    writer.exec("UPDATE users SET password_hash='new-hash' WHERE id=1; INSERT INTO users(id,email,salt,password_hash) VALUES (3,'new@example.test','salt','hash'); UPDATE user_id_sequence SET last_id=3; COMMIT;");
    const safe=path.join(dir,'service.sqlite');
    await assert.rejects(restoreForService(copy,safe,copy),/별도/);
    assert.equal((await restoreForService(copy,safe,source)).removed,1);
    const service=new DatabaseSync(safe,{readOnly:true});
    try{
      assert.deepEqual(service.prepare('SELECT id FROM users ORDER BY id').all().map(row=>row.id),[1,3]);
      assert.equal(service.prepare('SELECT password_hash FROM users WHERE id=1').get().password_hash,'new-hash');
      assert.equal(service.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
      assert.equal(service.prepare('SELECT COUNT(*) AS n FROM account_tokens').get().n,0);
      assert.equal(service.prepare('SELECT last_id FROM user_id_sequence').get().last_id,3);
      assert.equal(service.prepare('SELECT payload FROM progress WHERE user_id=1').get().payload,'{"version":1,"completed":[1]}');
    }finally{service.close();}
    console.log('PASS: live WAL backup, non-overwriting restore, account/progress recovery and application startup');
  }finally{writer.close();await new Promise(resolve=>app.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
