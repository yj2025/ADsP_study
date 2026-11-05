const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');
const {setupContent,parseFile,importContent}=require('./content-store.cjs');
function validationDatabase(database){
  const memory=new DatabaseSync(':memory:');
  setupContent(memory);
  if(!fs.existsSync(database))return memory;
  const existing=new DatabaseSync(database,{readOnly:true});
  try{
    if(!existing.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='content_lessons'").get())return memory;
    existing.exec('BEGIN');
    memory.exec('DELETE FROM content_questions; DELETE FROM content_lessons;');
    const lesson=memory.prepare('INSERT INTO content_lessons(position,id,title,body,body_format,source_url,license) VALUES (?,?,?,?,?,?,?)');
    for(const l of existing.prepare('SELECT * FROM content_lessons ORDER BY position').all())lesson.run(l.position,l.id,l.title,l.body,l.body_format,l.source_url,l.license);
    const question=memory.prepare('INSERT INTO content_questions(position,id,lesson_id,text,options,answer,explanation,source_url,license) VALUES (?,?,?,?,?,?,?,?,?)');
    for(const q of existing.prepare('SELECT * FROM content_questions ORDER BY position').all())question.run(q.position,q.id,q.lesson_id,q.text,q.options,q.answer,q.explanation,q.source_url,q.license);
    existing.exec('COMMIT');
    return memory;
  }catch(error){memory.close();throw error;}finally{existing.close();}
}
function run(args){
  const filename=args.shift();let database=path.join(__dirname,'data','study.sqlite'),dryRun=false;
  if(!filename||filename==='--help'){console.log('사용법: node import-content.cjs <file.json|file.csv> [--dry-run] [--database <SQLite 경로>]');return;}
  while(args.length){const arg=args.shift();if(arg==='--dry-run')dryRun=true;else if(arg==='--database'&&args.length)database=path.resolve(args.shift());else throw Error(`알 수 없는 옵션: ${arg}`);}
  const bundle=parseFile(filename);
  // A dry run never creates or migrates the actual database.
  if(dryRun){const memory=validationDatabase(database);try{console.log(JSON.stringify(importContent(memory,bundle,{dryRun:true})));}finally{memory.close();}return;}
  fs.mkdirSync(path.dirname(database),{recursive:true});const db=new DatabaseSync(database);try{db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');setupContent(db);console.log(JSON.stringify(importContent(db,bundle)));}finally{db.close();}
}
if(require.main===module){try{run(process.argv.slice(2));}catch(error){console.error(`가져오기 실패: ${error.message}`);process.exitCode=1;}}
module.exports={run};
