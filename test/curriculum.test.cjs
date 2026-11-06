const {DatabaseSync}=require('node:sqlite');
const {setupContent,readContent,parseFile,importContent}=require('../src/content-store.cjs');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const seed=JSON.parse(fs.readFileSync('content/seed.json','utf8'));

// Reproduce the schema and records from before subjects/units existed.
const legacy=new DatabaseSync(':memory:');legacy.exec(`PRAGMA foreign_keys=ON;
  CREATE TABLE content_lessons(position INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL,body_format TEXT NOT NULL DEFAULT 'text',source_url TEXT NOT NULL DEFAULT '',license TEXT NOT NULL DEFAULT '');
  CREATE TABLE content_questions(position INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,lesson_id TEXT NOT NULL REFERENCES content_lessons(id),text TEXT NOT NULL,options TEXT NOT NULL,answer INTEGER NOT NULL,explanation TEXT NOT NULL,source_url TEXT NOT NULL DEFAULT '',license TEXT NOT NULL DEFAULT '');
  CREATE TABLE content_migrations(id TEXT PRIMARY KEY);
  INSERT INTO content_migrations VALUES ('legacy-v1');
  CREATE TABLE progress(user_id INTEGER PRIMARY KEY,payload TEXT NOT NULL);`);
for(const l of seed.lessons)legacy.prepare('INSERT INTO content_lessons(id,title,body,body_format) VALUES (?,?,?,?)').run(l.id,l.title,l.body,'html');
for(const q of seed.questions)legacy.prepare('INSERT INTO content_questions(id,lesson_id,text,options,answer,explanation) VALUES (?,?,?,?,?,?)').run(q.id,q.lesson_id,q.text,JSON.stringify(q.options),q.answer,q.explanation);
const record={version:1,completed:[0,2],lesson:2,quizIndex:4,answers:{q1:0,q2:1},wrong:['q1'],resolved:['q1']};
const raw=JSON.stringify(record);legacy.prepare('INSERT INTO progress VALUES (?,?)').run(1,raw);
const oldLessons=legacy.prepare('SELECT * FROM content_lessons ORDER BY position').all();
const oldQuestions=legacy.prepare('SELECT * FROM content_questions ORDER BY position').all();
setupContent(legacy);setupContent(legacy);
assert.equal(legacy.prepare('SELECT payload FROM progress WHERE user_id=1').get().payload,raw);
const originalFields=({review_status,reviewed_at,reviewed_by,...row})=>row;
assert.deepEqual(legacy.prepare('SELECT * FROM content_questions ORDER BY position').all().map(originalFields),oldQuestions.map(q=>({...q})));
const migrated=legacy.prepare('SELECT * FROM content_lessons ORDER BY position').all();
assert.deepEqual(migrated.map(({unit_id,...l})=>originalFields(l)),oldLessons.map(l=>({...l})));assert.ok(migrated.every(l=>l.unit_id==='data-information'&&l.review_status==='published'));
let data=readContent(legacy);assert.equal(data.subjects.length,3);assert.equal(data.units.length,4);
assert.ok(data.questions.every(q=>q.unit_id==='data-information'));
const bundle=parseFile('content/subject-example.json');
assert.equal(importContent(legacy,bundle,{dryRun:true}).units,1);assert.equal(readContent(legacy).units.length,4);
importContent(legacy,bundle);importContent(legacy,parseFile('content/subject-example.csv'));
assert.throws(()=>importContent(legacy,{units:[{id:'bad-unit',subject_id:'missing-subject',title:'bad'}]}),/subject_id/);
assert.throws(()=>importContent(legacy,{lessons:[{id:'bad-lesson',unit_id:'missing-unit',title:'bad',body:'bad'}]}),/unit_id/);
assert.throws(()=>importContent(legacy,{subjects:[{id:'rollback-subject',title:'rollback'}],units:[{id:'rollback-unit',subject_id:'missing',title:'bad'}]}),/subject_id/);
assert.equal(legacy.prepare('SELECT id FROM content_subjects WHERE id=?').get('rollback-subject'),undefined);
importContent(legacy,{subjects:[{id:'custom-subject',title:'추가 과목'}],units:[{id:'custom-unit',title:'추가 단원',subject_id:'custom-subject'}],lessons:[{id:'custom-lesson',unit_id:'custom-unit',title:'추가 개념',body:'설명'}]});
data=readContent(legacy);legacy.close();

function boot(payload,stored=record,account=false){
  const handlers={},elements={},memory={'adsp-study-v1':JSON.stringify(stored)};
  const c={console,location:{hash:'#home'},confirm:()=>true,localStorage:{getItem:k=>memory[k]??null,setItem:(k,v)=>memory[k]=v},document:{getElementById:id=>elements[id]??={innerHTML:'',textContent:'',addEventListener:(type,fn)=>handlers[id+type]=fn,focus:()=>{}},querySelectorAll:()=>[]},window:{addEventListener:()=>{},scrollTo:()=>{}}};
  vm.createContext(c);vm.runInContext(fs.readFileSync('dist/app.js','utf8'),c);c.payload=payload;vm.runInContext('installContent(payload)',c);
  if(account){c.window.StudyAuth={user:{id:1},save:value=>c.saved=JSON.parse(JSON.stringify(value)),status:()=>{}};}
  return {run:s=>vm.runInContext(s,c),click:dataset=>handlers.mainclick({target:{closest:()=>({dataset,disabled:false})}}),reset:()=>handlers.resetclick(),memory,c,elements};
}
let app=boot(data);
assert.equal(app.run('state.selectedUnitId'),'data-information');assert.equal(app.run('state.completed.length'),2);assert.equal(app.run('answered()'),2);assert.equal(app.run('progress()'),50);assert.equal(app.run('state.lesson'),2);assert.equal(app.run('state.quizIndex'),4);
app.run('chooseUnit("analysis-approach")');
assert.equal(app.run('activeSubject().id'),'analysis-planning');assert.equal(app.run('lessonIndices().length'),1);assert.equal(app.run('unitQuestions().length'),1);assert.equal(app.run('answered()'),0);assert.equal(app.run('progress()'),0);assert.equal(app.run('pending().length'),0);assert.ok(!app.run('review()').includes('고객 인터뷰'));
assert.match(app.run('learn()'),/목적에서 출발하는 분석/);assert.ok(!app.run('learn()').includes('DIKW:'));
app.click({action:'complete'});app.click({choice:'1'});app.click({action:'submit'});assert.equal(app.run('pending().length'),1);assert.equal(app.run('answered()'),1);
app.run('chooseUnit("data-information")');assert.equal(app.run('state.lesson'),2);assert.equal(app.run('state.quizIndex'),4);assert.equal(app.run('answered()'),2);assert.equal(app.run('state.answers["approach-q1"]'),1);assert.equal(app.run('pending().length'),0);assert.equal(app.run('state.resolved.includes("q1")'),true);
app.run('chooseUnit("analysis-approach")');assert.equal(app.run('pending().length'),1);app.click({review:'approach-q1'});app.click({choice:'0'});app.click({action:'review-submit'});assert.equal(app.run('progress()'),100);
const saved=JSON.parse(app.memory['adsp-study-v1']);app=boot(data,saved);assert.equal(app.run('state.selectedUnitId'),'analysis-approach');assert.equal(app.run('progress()'),100);assert.equal(app.run('state.answers.q1'),0);
app.reset();assert.equal(app.run('progress()'),0);assert.equal(app.run('state.answers.q1'),0);assert.equal(app.run('state.resolved.includes("q1")'),true);assert.equal(app.run('completedCount("data-information")'),2);
app.run('chooseUnit("database-basics")');for(const page of ['home','learn','quiz','review'])assert.doesNotThrow(()=>app.run(`${page}()`));assert.equal(app.run('progress()'),0);assert.match(app.run('learn()'),/아직 등록된 개념/);assert.match(app.run('quiz()'),/아직 등록된 문제/);
app.run('chooseSubject("custom-subject")');assert.equal(app.run('state.selectedUnitId'),'custom-unit');assert.match(app.run('learn()'),/추가 개념/);assert.match(app.run('quiz()'),/아직 등록된 문제/);
// Unit choice and all records are serialized together for authenticated accounts too.
app=boot(data,record,true);app.run('chooseUnit("analysis-approach")');assert.equal(app.c.saved.selectedUnitId,'analysis-approach');assert.equal(app.c.saved.answers.q1,0);app=boot(data,app.c.saved,true);assert.equal(app.run('activeSubject().id'),'analysis-planning');assert.equal(app.run('state.completed.length'),2);
const interleaved={...data,questions:[...data.questions,{...data.questions[0],id:'tail-question'}]};
app=boot(interleaved);app.run('state.quizIndex=5');app.click({action:'next'});assert.equal(app.run('questions[state.quizIndex].id'),'tail-question');app.click({action:'previous-question'});assert.equal(app.run('questions[state.quizIndex].id'),'q6');
console.log('PASS: legacy schema/progress preservation, idempotent migration, JSON/CSV curriculum import, reference checks, unit isolation, cursors, refresh/account restoration, scoped reset, empty units');
