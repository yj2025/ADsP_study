const fail=(message,status=400)=>Object.assign(Error(message),{status});
const {validateBundle}=require('./content-store.cjs');
const lessonSql='SELECT id,title,body,body_format,source_url,license,reviewed_at,reviewed_by FROM content_lessons WHERE unit_id=? AND review_status=? ORDER BY position';
const questionSql='SELECT q.id,q.text title,q.options,q.answer,q.explanation,q.source_url,q.license,q.reviewed_at,q.reviewed_by,l.title lesson_title,l.id lesson_id FROM content_questions q JOIN content_lessons l ON l.id=q.lesson_id WHERE l.unit_id=? AND q.review_status=? ORDER BY q.position';
function reviewList(db,unit,status){
  if(typeof unit!=='string'||!db.prepare('SELECT id FROM content_units WHERE id=?').get(unit))throw fail('등록된 단원을 선택해 주세요.');
  if(!['draft','published'].includes(status))throw fail('검수 상태를 확인해 주세요.');
  db.exec('BEGIN');
  try{
    const items=[...db.prepare(lessonSql).all(unit,status).map(row=>({...row,type:'lesson'})),...db.prepare(questionSql).all(unit,status).map(row=>({...row,type:'question',options:JSON.parse(row.options)}))];
    db.exec('COMMIT');return {items};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
function publish(db,input,userId,authorized){
  const {unit_id,items}=input??{};
  if(typeof unit_id!=='string'||!Array.isArray(items)||!items.length||items.length>1000)throw fail('공개할 항목을 1~1,000개 선택해 주세요.');
  const selection=new Map();
  for(const item of items){
    if(!['lesson','question'].includes(item?.type)||typeof item.id!=='string'||!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(item.id))throw fail('선택한 항목을 확인해 주세요.');
    const key=`${item.type}:${item.id}`;if(selection.has(key))throw fail('중복 선택된 항목이 있습니다.');selection.set(key,item);
  }
  db.exec('BEGIN IMMEDIATE');
  try{
    if(!authorized())throw fail('관리자 권한이 변경되었습니다.',403);
    const lesson=db.prepare('SELECT unit_id,review_status FROM content_lessons WHERE id=?');
    const question=db.prepare('SELECT unit_id,q.review_status,l.review_status lesson_status,l.id lesson_id FROM content_questions q JOIN content_lessons l ON l.id=q.lesson_id WHERE q.id=?');
    for(const {type,id} of selection.values()){
      const row=(type==='lesson'?lesson:question).get(id);
      if(!row||row.unit_id!==unit_id||row.review_status!=='draft')throw fail('목록이 변경되었습니다. 새로 불러온 뒤 다시 선택해 주세요.',409);
      if(type==='question'&&row.lesson_status!=='published'&&!selection.has(`lesson:${row.lesson_id}`))throw fail('문제가 참조하는 개념도 함께 선택하거나 먼저 공개해 주세요.',409);
    }
    const now=Date.now();
    const counts={lessons:0,questions:0};
    for(const type of ['lesson','question']){
      const table=type==='lesson'?'content_lessons':'content_questions';
      const update=db.prepare(`UPDATE ${table} SET review_status='published',reviewed_at=?,reviewed_by=? WHERE id=?`);
      for(const item of selection.values())if(item.type===type){update.run(now,userId,item.id);counts[`${type}s`]++;}
    }
    db.exec('COMMIT');return counts;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
function reviseQuestion(db,input,authorized){
  const {unit_id,id,action,changes}=input??{};
  if(typeof unit_id!=='string'||typeof id!=='string'||!['withdraw','edit'].includes(action))throw fail('문제와 작업을 확인해 주세요.');
  db.exec('BEGIN IMMEDIATE');
  try{
    if(!authorized())throw fail('관리자 권한이 변경되었습니다.',403);
    const row=db.prepare('SELECT q.*,l.unit_id FROM content_questions q JOIN content_lessons l ON q.lesson_id=l.id WHERE q.id=?').get(id);
    if(!row||row.unit_id!==unit_id||row.review_status!==(action==='withdraw'?'published':'draft')){
      throw fail('문제의 검수 상태가 변경되었습니다. 목록을 다시 불러와 주세요.',409);
    }
    if(action==='withdraw'){
      db.prepare("UPDATE content_questions SET review_status='draft' WHERE id=?").run(id);
    }else{
      if(!changes||typeof changes!=='object'||Array.isArray(changes))throw fail('수정할 문제 내용을 입력해 주세요.');
      const {text,options,answer,explanation}=changes;
      let clean;
      try{
        clean=validateBundle(db,{questions:[{id,lesson_id:row.lesson_id,text,options,answer,explanation,source_url:row.source_url,license:row.license}]},{editingQuestion:id}).questions[0];
      }catch(error){throw fail(error.message);}
      db.prepare('UPDATE content_questions SET text=?,options=?,answer=?,explanation=? WHERE id=?').run(clean.text,JSON.stringify(clean.options),clean.answer,clean.explanation,id);
    }
    db.exec('COMMIT');
    return {ok:true};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
module.exports={reviewList,publish,reviseQuestion};
