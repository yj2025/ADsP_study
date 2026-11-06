const crypto=require('node:crypto');
const {parseCSV,importContent}=require('./content-store.cjs');
const MAX_UPLOAD=2*1024*1024;
const fail=(message,status=422)=>Object.assign(Error(message),{status});
function setupAdmin(db){
  if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='role'))db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin'))");
  db.exec(`CREATE TABLE IF NOT EXISTS content_uploads (
    token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),session_hash TEXT NOT NULL,
    filename TEXT NOT NULL,unit_id TEXT NOT NULL REFERENCES content_units(id),bundle TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS content_imports (
    id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),filename TEXT NOT NULL,
    unit_id TEXT NOT NULL REFERENCES content_units(id),counts TEXT NOT NULL,created_at INTEGER NOT NULL);`);
}
function prepareUpload(db,input){
  if(!input||typeof input!=='object'||typeof input.filename!=='string'||input.filename.length>255||!/^.+\.(json|csv)$/i.test(input.filename))throw fail('CSV 또는 JSON 파일을 선택해 주세요.');
  if(typeof input.content!=='string'||!input.content.trim())throw fail('빈 파일은 가져올 수 없습니다.');
  if(Buffer.byteLength(input.content,'utf8')>MAX_UPLOAD)throw fail('파일 크기는 최대 2MB입니다.',413);
  const unit=db.prepare('SELECT u.id,u.subject_id,u.title,s.title subject_title FROM content_units u JOIN content_subjects s ON s.id=u.subject_id WHERE u.id=? AND s.id=?').get(input.unit_id??null,input.subject_id??null);
  if(!unit)throw fail('선택한 과목에 속한 단원을 지정해 주세요.');
  const text=input.content.replace(/^\uFEFF/,'');let bundle;
  try{bundle=/\.csv$/i.test(input.filename)?parseCSV(text):JSON.parse(text);}catch(error){throw fail(/\.csv$/i.test(input.filename)?error.message:'JSON 문법이 올바르지 않습니다.');}
  if(!bundle||typeof bundle!=='object'||Array.isArray(bundle))throw fail('파일 최상위는 개념·문제 배열이 있는 객체여야 합니다.');
  if(Object.keys(bundle).some(k=>!['subjects','units','lessons','questions'].includes(k)))throw fail('파일에 알 수 없는 최상위 필드가 있습니다.');
  if(bundle.subjects!==undefined&&(!Array.isArray(bundle.subjects)||bundle.subjects.length)||bundle.units!==undefined&&(!Array.isArray(bundle.units)||bundle.units.length))throw fail('화면에서는 기존 과목·단원에 개념과 문제를 추가합니다. 새 과목·단원 정의는 CLI 가져오기를 사용해 주세요.');
  if(bundle.lessons!==undefined&&!Array.isArray(bundle.lessons)||bundle.questions!==undefined&&!Array.isArray(bundle.questions))throw fail('lessons와 questions는 배열이어야 합니다.');
  const lessons=bundle.lessons??[],questions=bundle.questions??[];
  if(lessons.some(l=>!l||typeof l!=='object'||Array.isArray(l)))throw fail('개념 행은 객체여야 합니다.');
  const warnings=[];
  if(lessons.some(l=>l.unit_id&&l.unit_id!==unit.id))warnings.push('파일의 unit_id 대신 화면에서 선택한 단원으로 모든 신규 개념을 배정합니다.');
  const scoped={lessons:lessons.map(l=>({...l,unit_id:unit.id})),questions};
  const added=new Set(lessons.map(l=>l.id));
  for(const q of questions){
    if(!q||typeof q!=='object'||Array.isArray(q))throw fail('문제 행은 객체여야 합니다.');
    if(!added.has(q.lesson_id)){
      const existing=typeof q.lesson_id==='string'?db.prepare('SELECT unit_id FROM content_lessons WHERE id=?').get(q.lesson_id):null;
      if(existing&&existing.unit_id!==unit.id)throw fail(`문제 ${q.id??''}: 참조 개념이 선택한 단원에 속하지 않습니다.`);
    }
  }
  let counts;try{counts=importContent(db,scoped,{dryRun:true});}catch(error){throw fail(error.message);}
  return {bundle:scoped,counts,unit,warnings,preview:[...scoped.lessons.map(l=>({type:'개념',id:l.id,title:l.title})),...questions.map(q=>({type:'문제',id:q.id,title:q.text}))].slice(0,100)};
}
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
module.exports={setupAdmin,prepareUpload,digest,MAX_UPLOAD};
