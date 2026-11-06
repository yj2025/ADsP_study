const fs = require('node:fs');
const path = require('node:path');

const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setupContent(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS content_lessons (
    position INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL, body TEXT NOT NULL, body_format TEXT NOT NULL DEFAULT 'text',
    source_url TEXT NOT NULL DEFAULT '', license TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS content_questions (
    position INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    lesson_id TEXT NOT NULL REFERENCES content_lessons(id), text TEXT NOT NULL,
    options TEXT NOT NULL, answer INTEGER NOT NULL CHECK(answer BETWEEN 0 AND 3),
    explanation TEXT NOT NULL, source_url TEXT NOT NULL DEFAULT '', license TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS content_migrations (id TEXT PRIMARY KEY);`);
  if (!db.prepare('SELECT id FROM content_migrations WHERE id=?').get('legacy-v1')) {
    // Only this repository-owned initial seed may contain rich HTML.
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname,'..','content','seed.json'),'utf8'));
    db.exec('BEGIN IMMEDIATE');
    try {
      for(const l of seed.lessons) db.prepare('INSERT INTO content_lessons(id,title,body,body_format) VALUES (?,?,?,?)').run(l.id,l.title,l.body,'html');
      for(const q of seed.questions) db.prepare('INSERT INTO content_questions(id,lesson_id,text,options,answer,explanation) VALUES (?,?,?,?,?,?)').run(q.id,q.lesson_id,q.text,JSON.stringify(q.options),q.answer,q.explanation);
      db.prepare('INSERT INTO content_migrations VALUES (?)').run('legacy-v1');
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK');throw error; }
  }
  setupCurriculum(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT id FROM content_migrations WHERE id=?').get('review-v1')) {
      for (const table of ['content_lessons','content_questions']) db.exec(`ALTER TABLE ${table} ADD COLUMN review_status TEXT NOT NULL DEFAULT 'published' CHECK(review_status IN ('draft','published')); ALTER TABLE ${table} ADD COLUMN reviewed_at INTEGER; ALTER TABLE ${table} ADD COLUMN reviewed_by INTEGER;`);
      db.prepare('INSERT INTO content_migrations VALUES (?)').run('review-v1');
    }
    db.exec('COMMIT');
  } catch (error) {db.exec('ROLLBACK');throw error;}
}
function setupCurriculum(db){
  if(db.prepare('SELECT id FROM content_migrations WHERE id=?').get('curriculum-v1'))return;
  const curriculum=JSON.parse(fs.readFileSync(path.join(__dirname,'..','content','curriculum.json'),'utf8'));
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec(`CREATE TABLE content_subjects (position INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, title TEXT NOT NULL);
      CREATE TABLE content_units (position INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, subject_id TEXT NOT NULL REFERENCES content_subjects(id), title TEXT NOT NULL);`);
    for(const s of curriculum.subjects)db.prepare('INSERT INTO content_subjects(id,title) VALUES (?,?)').run(s.id,s.title);
    for(const u of curriculum.units)db.prepare('INSERT INTO content_units(id,subject_id,title) VALUES (?,?,?)').run(u.id,u.subject_id,u.title);
    db.exec(`ALTER TABLE content_lessons ADD COLUMN unit_id TEXT REFERENCES content_units(id);
      UPDATE content_lessons SET unit_id='data-information';
      CREATE TRIGGER content_lessons_unit_insert BEFORE INSERT ON content_lessons WHEN NEW.unit_id IS NULL BEGIN SELECT RAISE(ABORT,'unit_id is required'); END;
      CREATE TRIGGER content_lessons_unit_update BEFORE UPDATE OF unit_id ON content_lessons WHEN NEW.unit_id IS NULL BEGIN SELECT RAISE(ABORT,'unit_id is required'); END;`);
    db.prepare('INSERT INTO content_migrations VALUES (?)').run('curriculum-v1');
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
function readContent(db) {
  db.exec('BEGIN');
  try {
  const rows=db.prepare("SELECT * FROM content_lessons WHERE review_status='published' ORDER BY position").all();
  const lessons=rows.map(l=>({id:l.id,unit_id:l.unit_id,title:escapeHTML(l.title),body:l.body_format==='html'?l.body:`<div class="content-text">${escapeHTML(l.body)}</div>`,source_url:l.source_url,license:l.license}));
  const indices=new Map(rows.map((l,i)=>[l.id,i]));
  const questions=db.prepare("SELECT q.* FROM content_questions q JOIN content_lessons l ON l.id=q.lesson_id WHERE q.review_status='published' AND l.review_status='published' ORDER BY q.position").all().map(q=>({id:q.id,lesson_id:q.lesson_id,lesson:indices.get(q.lesson_id),text:escapeHTML(q.text),options:JSON.parse(q.options).map(escapeHTML),answer:q.answer,explanation:escapeHTML(q.explanation),source_url:q.source_url,license:q.license}));
  const subjects=db.prepare('SELECT id,title FROM content_subjects ORDER BY position').all().map(s=>({...s,title:escapeHTML(s.title)}));
  const units=db.prepare('SELECT id,subject_id,title FROM content_units ORDER BY position').all().map(u=>({...u,title:escapeHTML(u.title)}));
  for(const q of questions)q.unit_id=lessons[q.lesson].unit_id;
  db.exec('COMMIT');
  return {subjects,units,lessons,questions};
  } catch(error) { db.exec('ROLLBACK');throw error; }
}
function parseCSV(text) {
  text=text.replace(/^\uFEFF/,'');
  const rows=[];let row=[],field='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
    if(c==='"'){if(field||closed)throw Error('CSV: 따옴표 위치가 올바르지 않습니다.');quoted=true;}
    else if(c===','||c==='\n'||c==='\r') {
      row.push(field);field='';closed=false;
      if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v!==''))rows.push(row);row=[];}
    } else {if(closed)throw Error('CSV: 닫힌 따옴표 뒤에는 구분자만 올 수 있습니다.');field+=c;}
  }
  if(quoted)throw Error('CSV: 닫히지 않은 따옴표가 있습니다.');
  if(field!==''||closed||row.length){row.push(field);if(row.some(v=>v!==''))rows.push(row);}
  if(!rows.length)throw Error('CSV가 비어 있습니다.');
  const headers=rows.shift().map(v=>v.trim());
  const allowed=new Set(['type','id','title','body','subject_id','unit_id','lesson_id','text','option1','option2','option3','option4','answer','explanation','source_url','license']);
  if(new Set(headers).size!==headers.length||headers.some(h=>!allowed.has(h)))throw Error('CSV: 중복되거나 알 수 없는 열 이름입니다.');
  if(!headers.includes('type')||!headers.includes('id'))throw Error('CSV에는 type, id 열이 필요합니다.');
  const bundle={lessons:[],questions:[]};
  rows.forEach((values,i)=>{
    if(values.length!==headers.length)throw Error(`CSV ${i+2}행: 열 개수가 일치하지 않습니다.`);
    const r=Object.fromEntries(headers.map((h,n)=>[h,values[n]]));
    const meta={id:r.id,source_url:r.source_url,license:r.license};
    if(r.type==='subject')(bundle.subjects??=[]).push({id:r.id,title:r.title});
    else if(r.type==='unit')(bundle.units??=[]).push({id:r.id,subject_id:r.subject_id,title:r.title});
    else if(r.type==='lesson')bundle.lessons.push({...meta,title:r.title,body:r.body,...(r.unit_id?{unit_id:r.unit_id}:{})});
    else if(r.type==='question')bundle.questions.push({...meta,lesson_id:r.lesson_id,text:r.text,options:[r.option1,r.option2,r.option3,r.option4],answer:/^[1-4]$/.test(r.answer)?Number(r.answer)-1:r.answer,explanation:r.explanation});
    else throw Error(`CSV ${i+2}행: type은 subject, unit, lesson 또는 question이어야 합니다.`);
  });
  return bundle;
}
function parseFile(filename) {
  if(fs.statSync(filename).size>2*1024*1024)throw Error('파일 크기는 최대 2MB입니다.');
  const text=fs.readFileSync(filename,'utf8').replace(/^\uFEFF/,'');
  switch(path.extname(filename).toLowerCase()) {
    case '.csv':return parseCSV(text);
    case '.json':try{return JSON.parse(text);}catch{throw Error('JSON 문법이 올바르지 않습니다.');}
    default:throw Error('.csv 또는 .json 파일만 지원합니다.');
  }
}
function validateBundle(db,bundle,{editingQuestion}={}) {
  if(!bundle||typeof bundle!=='object'||Array.isArray(bundle)||Object.keys(bundle).some(k=>!['subjects','units','lessons','questions'].includes(k)))throw Error('JSON 최상위는 subjects/units/lessons/questions 배열을 포함하는 객체여야 합니다.');
  const subjects=bundle.subjects??[],units=bundle.units??[],lessons=bundle.lessons??[],questions=bundle.questions??[];
  const groups=[subjects,units,lessons,questions];
  if(groups.some(g=>!Array.isArray(g))||!groups.some(g=>g.length))throw Error('추가할 subjects, units, lessons 또는 questions 배열이 필요합니다.');
  if(groups.reduce((n,g)=>n+g.length,0)>1000)throw Error('한 번에 최대 1,000개를 가져올 수 있습니다.');
  const existingLessons=new Set(db.prepare('SELECT id FROM content_lessons').all().map(l=>l.id));
  const existingQuestions=new Set(db.prepare('SELECT id FROM content_questions').all().map(q=>q.id));
  if(editingQuestion)existingQuestions.delete(editingQuestion);
  const string=(v,label,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(`${label}: 비어 있지 않은 문자열(최대 ${max}자)이 필요합니다.`);return v;};
  const id=(v,label)=>{if(typeof v!=='string'||!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(v))throw Error(`${label}: 영문자로 시작하는 영문·숫자·밑줄·하이픈 ID(최대 64자)가 필요합니다.`);return v;};
  const existingSubjects=new Set(db.prepare('SELECT id FROM content_subjects').all().map(r=>r.id));
  const existingUnits=new Set(db.prepare('SELECT id FROM content_units').all().map(r=>r.id));
  const structural=(records,kind,allowed,existing)=>records.map((r,i)=>{
    const label=`${kind} ${i+1}`;
    if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!allowed.includes(k)))throw Error(`${label}: 객체의 필드가 올바르지 않습니다.`);
    const key=id(r.id,label);if(existing.has(key))throw Error(`${label}: 중복 ID ${key}`);existing.add(key);
    if(kind==='단원'&&!existingSubjects.has(r.subject_id))throw Error(`${label}: 존재하지 않는 subject_id ${r.subject_id}`);
    return {id:key,title:string(r.title,`${label} title`,200),...(kind==='단원'?{subject_id:r.subject_id}:{})};
  });
  const cleanSubjects=structural(subjects,'과목',['id','title'],existingSubjects);
  const cleanUnits=structural(units,'단원',['id','title','subject_id'],existingUnits);
  const metadata=(r,label)=>{const source_url=r.source_url??'',license=r.license??'';if(typeof source_url!=='string'||source_url.length>2000)throw Error(`${label}: source_url이 올바르지 않습니다.`);if(source_url){let u;try{u=new URL(source_url);}catch{throw Error(`${label}: source_url은 HTTP(S) 주소여야 합니다.`);}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error(`${label}: source_url은 자격증명이 없는 HTTP(S) 주소여야 합니다.`);}if(typeof license!=='string'||license.length>1000)throw Error(`${label}: license는 최대 1,000자의 문자열입니다.`);return {source_url,license};};
  const cleanLessons=lessons.map((l,i)=>{
    const label=`개념 ${i+1}`;if(!l||typeof l!=='object'||Array.isArray(l))throw Error(`${label}: 객체가 필요합니다.`);
    if(Object.keys(l).some(k=>!['id','title','body','unit_id','source_url','license'].includes(k)))throw Error(`${label}: 알 수 없는 필드입니다. HTML 형식은 가져올 수 없습니다.`);
    const key=id(l.id,label);if(existingLessons.has(key))throw Error(`${label}: 중복 ID ${key}`);existingLessons.add(key);
    const unit_id=l.unit_id??'data-information';if(!existingUnits.has(unit_id))throw Error(`${label}: 존재하지 않는 unit_id ${unit_id}`);
    return {id:key,unit_id,title:string(l.title,`${label} title`,200),body:string(l.body,`${label} body`,50000),...metadata(l,label)};
  });
  const cleanQuestions=questions.map((q,i)=>{
    const label=`문제 ${i+1}`;if(!q||typeof q!=='object'||Array.isArray(q))throw Error(`${label}: 객체가 필요합니다.`);
    if(Object.keys(q).some(k=>!['id','lesson_id','text','options','answer','explanation','source_url','license'].includes(k)))throw Error(`${label}: 알 수 없는 필드입니다.`);
    const key=id(q.id,label);if(existingQuestions.has(key))throw Error(`${label}: 중복 ID ${key}`);existingQuestions.add(key);
    if(!existingLessons.has(q.lesson_id))throw Error(`${label}: 존재하지 않는 lesson_id ${q.lesson_id}`);
    if(!Array.isArray(q.options)||q.options.length!==4)throw Error(`${label}: 보기는 정확히 4개여야 합니다.`);
    const options=q.options.map((v,n)=>string(v,`${label} 보기 ${n+1}`,2000));
    if(new Set(options.map(v=>v.trim())).size!==4)throw Error(`${label}: 중복 보기가 있습니다.`);
    if(!Number.isInteger(q.answer)||q.answer<0||q.answer>3)throw Error(`${label}: JSON answer는 0~3 정수, CSV answer는 1~4 번호입니다.`);
    return {id:key,lesson_id:q.lesson_id,text:string(q.text,`${label} text`,10000),options,answer:q.answer,explanation:string(q.explanation,`${label} explanation`,20000),...metadata(q,label)};
  });
  return {subjects:cleanSubjects,units:cleanUnits,lessons:cleanLessons,questions:cleanQuestions};
}
function importContent(db,bundle,{dryRun=false,afterInsert,reviewStatus='published'}={}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const clean=validateBundle(db,bundle);
    if(!dryRun){
      for(const s of clean.subjects)db.prepare('INSERT INTO content_subjects(id,title) VALUES (?,?)').run(s.id,s.title);
      for(const u of clean.units)db.prepare('INSERT INTO content_units(id,subject_id,title) VALUES (?,?,?)').run(u.id,u.subject_id,u.title);
      const lesson=db.prepare('INSERT INTO content_lessons(id,title,body,source_url,license,unit_id,review_status) VALUES (?,?,?,?,?,?,?)');
      const question=db.prepare('INSERT INTO content_questions(id,lesson_id,text,options,answer,explanation,source_url,license,review_status) VALUES (?,?,?,?,?,?,?,?,?)');
      for(const l of clean.lessons)lesson.run(l.id,l.title,l.body,l.source_url,l.license,l.unit_id,reviewStatus);
      for(const q of clean.questions)question.run(q.id,q.lesson_id,q.text,JSON.stringify(q.options),q.answer,q.explanation,q.source_url,q.license,reviewStatus);
      if(afterInsert)afterInsert({lessons:clean.lessons.length,questions:clean.questions.length});
    }
    db.exec(dryRun?'ROLLBACK':'COMMIT');
    return {lessons:clean.lessons.length,questions:clean.questions.length,dryRun,...(clean.subjects.length?{subjects:clean.subjects.length}:{}),...(clean.units.length?{units:clean.units.length}:{})};
  } catch(error){db.exec('ROLLBACK');throw error;}
}
module.exports={setupContent,readContent,parseCSV,parseFile,importContent,validateBundle};
