'use strict';
const KEY='adsp-study-v1';
const DEFAULT_SUBJECT='data-understanding',DEFAULT_UNIT='data-information';
let subjects=[],units=[],lessons=[],questions=[];
let storageOK=true,state=fresh();
let selected=null,reviewId=null,reviewResult=null,quizSummary=false;
const main=document.getElementById('main');

function fresh(){return {version:1,completed:[],lesson:0,answers:{},wrong:[],resolved:[],quizIndex:0,selectedSubjectId:DEFAULT_SUBJECT,selectedUnitId:DEFAULT_UNIT,positions:{}};}
function lessonIndices(unitId=state.selectedUnitId){return lessons.flatMap((l,i)=>l.unit_id===unitId?[i]:[]);}
function unitQuestions(unitId=state.selectedUnitId){return questions.filter(q=>lessons[q.lesson]?.unit_id===unitId);}
function activeSubject(){return subjects.find(s=>s.id===state.selectedSubjectId);}
function activeUnit(){return units.find(u=>u.id===state.selectedUnitId);}
function normalizeSelection(s){
  const subject=subjects.find(v=>v.id===s.selectedSubjectId)||subjects[0];
  const candidates=units.filter(u=>u.subject_id===subject?.id);
  const unit=candidates.find(u=>u.id===s.selectedUnitId)||candidates[0];
  s.selectedSubjectId=subject?.id??null;s.selectedUnitId=unit?.id??null;
  const indices=lessonIndices(s.selectedUnitId),scoped=unitQuestions(s.selectedUnitId),saved=s.positions[s.selectedUnitId];
  if(!indices.includes(s.lesson))s.lesson=indices.find(i=>lessons[i].id===saved?.lessonId)??indices[0]??-1;
  if(!scoped.includes(questions[s.quizIndex]))s.quizIndex=questions.findIndex(q=>scoped.includes(q)&&q.id===saved?.questionId);
  if(s.quizIndex<0&&scoped.length)s.quizIndex=questions.indexOf(scoped[0]);
  return s;
}
function sanitize(value){
  const s=fresh();if(!value||value.version!==1)return normalizeSelection(s);
  s.completed=[...new Set((Array.isArray(value.completed)?value.completed:[]).filter(n=>Number.isInteger(n)&&n>=0&&n<lessons.length))];
  s.lesson=Number.isInteger(value.lesson)&&value.lesson>=0&&value.lesson<lessons.length?value.lesson:0;
  s.quizIndex=Number.isInteger(value.quizIndex)&&value.quizIndex>=0&&value.quizIndex<questions.length?value.quizIndex:0;
  for(const q of questions){const a=value.answers?.[q.id];if(Number.isInteger(a)&&a>=0&&a<4)s.answers[q.id]=a;}
  s.wrong=questions.filter(q=>q.id in s.answers&&s.answers[q.id]!==q.answer).map(q=>q.id);
  s.resolved=[...new Set((Array.isArray(value.resolved)?value.resolved:[]).filter(id=>s.wrong.includes(id)))];
  if(Array.isArray(value.completedIds))s.completed=[...new Set(value.completedIds.map(id=>lessons.findIndex(l=>l.id===id)).filter(i=>i>=0))];
  if(value.lessonId){const i=lessons.findIndex(l=>l.id===value.lessonId);if(i>=0)s.lesson=i;}
  if(value.questionId){const i=questions.findIndex(q=>q.id===value.questionId);if(i>=0)s.quizIndex=i;}
  for(const unit of units){const p=value.positions?.[unit.id];if(p&&typeof p==='object')s.positions[unit.id]={lessonId:lessons.find(l=>l.id===p.lessonId&&l.unit_id===unit.id)?.id,questionId:unitQuestions(unit.id).find(q=>q.id===p.questionId)?.id};}
  const savedUnit=units.find(u=>u.id===value.selectedUnitId),savedSubject=subjects.find(v=>v.id===value.selectedSubjectId);
  if(savedUnit){s.selectedUnitId=savedUnit.id;s.selectedSubjectId=savedUnit.subject_id;}
  else if(savedSubject){s.selectedSubjectId=savedSubject.id;s.selectedUnitId=null;}
  else{const unit=units.find(u=>u.id===lessons[s.lesson]?.unit_id);if(unit){s.selectedUnitId=unit.id;s.selectedSubjectId=unit.subject_id;}}
  return normalizeSelection(s);
}
function rememberPosition(){if(state.selectedUnitId)state.positions[state.selectedUnitId]={lessonId:lessons[state.lesson]?.id,questionId:questions[state.quizIndex]?.id};}
function progressSnapshot(){rememberPosition();return {...state,completedIds:state.completed.map(i=>lessons[i].id),lessonId:lessons[state.lesson]?.id,questionId:questions[state.quizIndex]?.id};}
function persist(){if(window.StudyAuth?.user){window.StudyAuth.save(progressSnapshot());return;}try{localStorage.setItem(KEY,JSON.stringify(progressSnapshot()));storageOK=true;}catch{storageOK=false;}updateSaveStatus();}
function updateSaveStatus(){if(window.StudyAuth?.user){window.StudyAuth.status();return;}document.getElementById('save-status').textContent=storageOK?'● 게스트 · 이 브라우저에 저장':'저장 불가 · 현재 탭에서만 유지';}
function clearActivity(){selected=null;reviewId=null;reviewResult=null;quizSummary=false;}
function chooseUnit(id){
  const unit=units.find(u=>u.id===id);if(!unit)return;
  rememberPosition();state.selectedSubjectId=unit.subject_id;state.selectedUnitId=id;state.lesson=-1;state.quizIndex=-1;
  normalizeSelection(state);clearActivity();persist();render();
}
function chooseSubject(id){
  if(!subjects.some(s=>s.id===id))return;
  const unit=units.find(u=>u.subject_id===id);
  if(unit){chooseUnit(unit.id);return;}
  rememberPosition();state.selectedSubjectId=id;state.selectedUnitId=null;state.lesson=-1;state.quizIndex=-1;clearActivity();persist();render();
}
function wrongIds(unitId=state.selectedUnitId){const ids=new Set(unitQuestions(unitId).map(q=>q.id));return state.wrong.filter(id=>ids.has(id));}
function pending(unitId=state.selectedUnitId){return wrongIds(unitId).filter(id=>!state.resolved.includes(id));}
function answered(unitId=state.selectedUnitId){return unitQuestions(unitId).filter(q=>q.id in state.answers).length;}
function correct(unitId=state.selectedUnitId){return unitQuestions(unitId).filter(q=>state.answers[q.id]===q.answer).length;}
function completedCount(unitId=state.selectedUnitId){return lessonIndices(unitId).filter(i=>state.completed.includes(i)).length;}
function progress(unitId=state.selectedUnitId){
  const wrong=wrongIds(unitId),denominator=lessonIndices(unitId).length+unitQuestions(unitId).length+wrong.length;
  return denominator?Math.round((completedCount(unitId)+answered(unitId)+wrong.filter(id=>state.resolved.includes(id)).length)/denominator*100):0;
}
function pathLabel(){return `${activeSubject()?.title??'과목'} / ${activeUnit()?.title??'단원 선택'}`;}
function heading(title,desc){return `<div class="intro"><div><div class="eyebrow">YOUR DAILY STUDY, ONE STEP CLOSER</div><h1>${title}</h1><p>${desc}</p></div><span class="date">${new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'short'})}</span></div>`;}
function scopePicker(){return `<section class="scope-picker" aria-label="학습 범위 선택"><div><span class="eyebrow">MY LEARNING PATH</span><strong>공부할 과목과 단원을 선택하세요</strong></div><label>과목<select id="subject-select">${subjects.map((s,i)=>`<option value="${s.id}" ${s.id===state.selectedSubjectId?'selected':''}>${i+1}과목 · ${s.title}</option>`).join('')}</select></label><label>단원<select id="unit-select" ${activeUnit()?'':'disabled'}>${units.filter(u=>u.subject_id===state.selectedSubjectId).map(u=>`<option value="${u.id}" ${u.id===state.selectedUnitId?'selected':''}>${u.title}${lessonIndices(u.id).length||unitQuestions(u.id).length?'':' · 준비 중'}</option>`).join('')||'<option>등록된 단원이 없습니다</option>'}</select></label></section>`;}
function unitCards(){return `<section class="unit-list"><div class="section-title"><h2>${activeSubject()?.title??'선택 과목'}의 단원</h2><span>단원을 선택해 이어서 학습하세요</span></div><div class="unit-grid">${units.filter(u=>u.subject_id===state.selectedSubjectId).map(u=>{const lc=lessonIndices(u.id).length,qc=unitQuestions(u.id).length;return `<button class="unit-card ${u.id===state.selectedUnitId?'selected':''}" data-unit="${u.id}" aria-pressed="${u.id===state.selectedUnitId}"><span class="pill">${lc||qc?`${progress(u.id)}% 학습`:'준비 중'}</span><strong>${u.title}</strong><small>개념 ${lc}개 · 문제 ${qc}개</small><div class="bar"><i style="width:${progress(u.id)}%"></i></div></button>`;}).join('')||'<p class="muted">아직 등록된 단원이 없습니다.</p>'}</div></section>`;}
function emptyPanel(kind){return `<section class="panel empty"><div class="symbol">▤</div><h2>${activeUnit()?.title??activeSubject()?.title??'학습 콘텐츠'}</h2><p class="muted">${kind==='subject'?'아직 등록된 단원이 없습니다. 다른 과목을 선택해 주세요.':kind==='lesson'?'아직 등록된 개념이 없습니다. 다른 단원을 선택하거나 문제 풀이를 확인해 보세요.':kind==='quiz'?'아직 등록된 문제가 없습니다. 개념 학습을 진행하거나 다른 단원을 선택해 주세요.':'이 단원은 콘텐츠를 준비 중입니다. 학습할 수 있는 다른 단원을 선택해 주세요.'}</p><div class="actions" style="justify-content:center"><a class="btn secondary" href="#home">단원 목록 보기</a>${kind==='quiz'&&lessonIndices().length?'<a class="btn" href="#learn">개념 학습하기 →</a>':''}${kind==='lesson'&&unitQuestions().length?'<a class="btn" href="#quiz">문제 풀기 →</a>':''}</div></section>`;}
function home(){
  const lc=lessonIndices().length,qc=unitQuestions().length,cc=completedCount();
  const introduction=heading('오늘도, 합격에 한 걸음 더.','선택한 단원의 개념부터 오답 복습까지, 차근차근 이어가세요.');
  if(!lc&&!qc)return introduction+unitCards()+emptyPanel(activeUnit()?'unit':'subject');
  return introduction+`<section class="hero"><div><span class="tag">${pathLabel()}</span><h2>${activeUnit().title}</h2><p>핵심 개념 ${lc}개와 ${qc}개의 문제로 이해도를 확인하세요.<br>선택한 단원의 진도와 오답을 따로 확인할 수 있어요.</p><a class="btn" href="#${lc?'learn':'quiz'}">${cc?'이어서 학습하기':'오늘의 학습 시작'} <span>→</span></a></div><div class="hero-art" aria-hidden="true"><span class="spark">✳</span><div class="book">ONE STEP<strong>MY<br>STUDY</strong>ADsP ───</div></div></section><section class="stats" aria-label="선택 단원 학습 통계"><div class="stat"><div class="stat-label">단원 학습 진도 <span>◴</span></div><strong>${progress()}<small>%</small></strong><div class="bar"><i style="width:${progress()}%"></i></div><div class="stat-foot">개념 · 문제 · 오답 복습 반영</div></div><div class="stat"><div class="stat-label">풀이한 문제 <span>▤</span></div><strong>${answered()}<small>/ ${qc}문제</small></strong><div class="stat-foot">선택 단원의 문제만 집계해요</div></div><div class="stat"><div class="stat-label">첫 풀이 정답률 <span>◎</span></div><strong>${answered()?Math.round(correct()/answered()*100):0}<small>%</small></strong><div class="stat-foot">${answered()?`${answered()}문제 중 ${correct()}문제 정답`:'첫 문제를 풀면 기록이 시작돼요'}</div></div></section>${unitCards()}<div class="columns"><section><div class="section-title"><h2>나의 학습 로드맵</h2><span>SELECTED UNIT</span></div><div class="panel"><div class="chapter-top"><span class="chapter-icon">▤</span><div><small>${activeSubject().title}</small><h3>${activeUnit().title}</h3></div><span class="pill" style="margin-left:auto">${progress()===100?'학습 완료':'학습 중'}</span></div>${step(1,'핵심 개념 학습',`개념 카드 ${cc} / ${lc}개 완료`,'learn',lc>0&&cc===lc)}${step(2,'단원 확인 문제',`예상 문제 ${answered()} / ${qc}개 풀이`,'quiz',qc>0&&answered()===qc)}${step(3,'오답 다시 풀기',pending().length?`${pending().length}문제 복습 대기`:'복습할 오답이 없습니다','review',qc>0&&answered()===qc&&!pending().length)}<div class="tip">✦ &nbsp;다른 단원으로 이동해도 지금까지의 학습 기록은 유지됩니다.</div></div></section><section><div class="section-title"><h2>잊기 전에, 한 번 더</h2><span>REVIEW</span></div><div class="panel review-box"><span class="pill">선택 단원의 오답 노트</span><div class="count">${pending().length}<small style="font-size:12px;margin-left:6px">문제</small></div><h3>${pending().length?'틀린 문제는 성장의 힌트예요.':'차근차근 실력을 쌓아가요.'}</h3><p>해설을 읽고 다시 풀어보세요.<br>맞힌 문제는 복습 완료로 기록돼요.</p><a class="btn secondary" href="#review">오답 노트 열기 <span>→</span></a></div><p class="note">ⓘ 학습 기록은 현재 기기와 브라우저에 저장됩니다.<br>브라우저 데이터를 삭제하면 기록도 지워집니다.</p></section></div>`;
}
function step(n,title,sub,route,done){return `<div class="step ${done?'done':''}"><span class="step-num">${done?'✓':n}</span><div>${title}<small>${sub}</small></div><a href="#${route}">${done?'다시 보기':'시작하기'} →</a></div>`;}
function learn(){
  const indices=lessonIndices(),i=state.lesson,n=indices.indexOf(i),top=heading('개념을 차근차근, 확실하게.',pathLabel());
  if(!indices.length)return top+emptyPanel('lesson');
  return top+`<div class="lesson-tabs" role="group" aria-label="개념 선택">${indices.map((index,j)=>`<button class="${index===i?'active':''}" data-lesson="${index}">${state.completed.includes(index)?'✓':String(j+1).padStart(2,'0')} ${lessons[index].title.split(':')[0]}</button>`).join('')}</div><article class="panel article"><span class="eyebrow">CONCEPT ${String(n+1).padStart(2,'0')} / ${String(indices.length).padStart(2,'0')}</span><h2>${lessons[i].title}</h2>${lessons[i].body}<div class="actions"><button class="btn secondary" data-action="prev" ${n===0?'disabled':''}>← 이전 개념</button><button class="btn" data-action="complete">${state.completed.includes(i)?'학습 완료 ✓ · ':''}${n===indices.length-1?'완료하고 문제 풀기 →':'완료하고 다음 개념 →'}</button></div></article>`;
}
function questionCard(q,mode){
  const scoped=unitQuestions(),isReview=mode==='review',a=isReview?reviewResult:state.answers[q.id],submitted=Number.isInteger(a),n=scoped.indexOf(q);
  return `<section class="panel question"><div class="section-title"><span class="pill">${lessons[q.lesson].title}</span><span>${isReview?'오답 재풀이':`QUESTION ${n+1} / ${scoped.length}`}</span></div>${!isReview?`<div class="bar"><i style="width:${answered()/scoped.length*100}%"></i></div>`:''}<h2>${q.text}</h2><div class="options" role="group" aria-label="답안 선택">${q.options.map((o,j)=>`<button class="option ${submitted?(j===q.answer?'correct':j===a?'incorrect':''):selected===j?'selected':''}" data-choice="${j}" aria-pressed="${selected===j||a===j}" ${submitted?'disabled':''}><span>${j+1}</span>${o}${submitted&&j===q.answer?' ✓':''}</button>`).join('')}</div>${submitted?`<div class="feedback ${a!==q.answer?'wrong':''}" role="status"><strong>${a===q.answer?'정답입니다!':`아쉬워요. 정답은 ${q.answer+1}번입니다.`}</strong><p>${q.explanation}</p><button class="btn secondary" data-concept="${q.lesson}" style="margin-top:12px">관련 개념 다시 보기 ↗</button></div>`:''}<div class="actions">${isReview?'<button class="btn secondary" data-action="review-list">목록으로</button>':`<button class="btn secondary" data-action="previous-question" ${n===0?'disabled':''}>← 이전 문제</button>`}${submitted?`<button class="btn" data-action="${isReview?'review-list':'next'}">${isReview?(a===q.answer?'복습 완료 · 목록으로':'목록에서 다시 도전'):(n===scoped.length-1?'학습 결과 보기':'다음 문제 →')}</button>`:`<button class="btn" data-action="${isReview?'review-submit':'submit'}" ${selected===null?'disabled':''}>정답 확인</button>`}</div></section>`;
}
function quiz(){
  const scoped=unitQuestions();
  if(!scoped.length)return heading('배운 내용을 내 것으로.',pathLabel())+emptyPanel('quiz');
  if(quizSummary)return heading('한 번 더 이해한 만큼, 앞으로.',pathLabel())+`<section class="panel empty"><span class="eyebrow">UNIT RESULT</span><h2>${activeUnit().title}</h2><div class="result-score">${correct()}<small style="font-size:20px"> / ${scoped.length}</small></div><p>${answered()}문제 풀이 · 복습 대기 ${pending().length}문제</p><div class="actions" style="justify-content:center"><a class="btn secondary" href="#home">대시보드</a><a class="btn" href="#review">오답 복습하기 →</a></div></section>`;
  return heading('배운 내용을 내 것으로.',`${pathLabel()} · 확인 문제 ${scoped.length}개`)+questionCard(questions[state.quizIndex],'quiz');
}
function review(){
  if(reviewId)return heading('다시 풀며, 더 단단하게.',pathLabel())+questionCard(questions.find(q=>q.id===reviewId),'review');
  const wrong=wrongIds(),resolved=wrong.filter(id=>state.resolved.includes(id));
  return heading('틀린 문제에서 실력이 자라요.',`${pathLabel()} · 이 단원에서 틀린 문제만 모았어요.`)+`<div class="section-title"><h2>복습 대기 ${pending().length}문제</h2><span>복습 완료 ${resolved.length}문제</span></div>${!wrong.length?`<section class="panel empty"><div class="symbol">✓</div><h2>이 단원에는 모인 오답이 없어요.</h2><p class="muted">${answered()?'지금까지 잘하고 있어요. 다음 문제도 도전해 보세요.':'단원 문제를 풀면 틀린 문제가 이곳에 자동으로 저장됩니다.'}</p><a class="btn" href="#quiz">문제 풀러 가기 →</a></section>`:wrong.map(id=>{const q=questions.find(q=>q.id===id),done=state.resolved.includes(id);return `<article class="panel review-item"><div class="section-title"><span class="pill">${done?'✓ 복습 완료':'↻ 복습 대기'} · ${lessons[q.lesson].title}</span><span>문제 ${unitQuestions().indexOf(q)+1}</span></div><h3>${q.text}</h3><p class="muted">첫 선택: ${q.options[state.answers[id]]}</p><button class="btn ${done?'secondary':''}" data-review="${id}">${done?'다시 연습하기':'정답 가리고 재풀이'} →</button></article>`;}).join('')}`;
}
function route(){const name=location.hash.slice(1);return ['learn','quiz','review','admin'].includes(name)?name:'home';}
function render(){
  if(!subjects.length){main.innerHTML='<section class="panel" role="status">학습 콘텐츠를 불러오는 중입니다.</section>';return;}
  const r=route();main.innerHTML=r==='admin'?(window.ContentAdmin?.render()??'<section class="panel" role="status">관리자 화면을 불러오는 중입니다.</section>'):(!storageOK?'<div class="notice">브라우저 저장소를 사용할 수 없어 기록이 현재 탭에서만 유지됩니다.</div>':'')+scopePicker()+({home,learn,quiz,review}[r])();
  document.getElementById('reset').hidden=r==='admin';
  if(r==='admin'&&window.StudyAuth?.user?.role==='admin'&&window.ContentReview)main.insertAdjacentHTML('beforeend',window.ContentReview.render());
  document.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===r));
  document.getElementById('breadcrumb').textContent=r==='admin'?'관리자 / 콘텐츠 관리':`${activeSubject()?.title??''} / ${activeUnit()?.title??'단원 선택'} / ${{home:'대시보드',learn:'개념 학습',quiz:'문제 풀이',review:'오답 노트'}[r]}`;
  document.getElementById('wrong-badge').textContent=pending().length;
  document.getElementById('curriculum-nav').innerHTML=subjects.map((s,i)=>`<button class="subject-button ${s.id===state.selectedSubjectId?'active':''}" data-subject="${s.id}" aria-pressed="${s.id===state.selectedSubjectId}"><span>${String(i+1).padStart(2,'0')}</span>${s.title}<small>${units.filter(u=>u.subject_id===s.id).length}개 단원</small></button>`).join('');
  updateSaveStatus();
}
function navigate(name){if(location.hash===`#${name}`)render();else location.hash=name;}
main.addEventListener('change',e=>{if(e.target.id==='subject-select')chooseSubject(e.target.value);if(e.target.id==='unit-select')chooseUnit(e.target.value);});
document.getElementById('curriculum-nav').addEventListener('click',e=>{const b=e.target.closest('[data-subject]');if(b)chooseSubject(b.dataset.subject);});
main.addEventListener('click',e=>{
  if(route()==='admin')return;
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.unit){chooseUnit(b.dataset.unit);return;}
  if(b.dataset.lesson!==undefined){if(!lessonIndices().includes(+b.dataset.lesson))return;state.lesson=+b.dataset.lesson;persist();}
  else if(b.dataset.choice!==undefined)selected=+b.dataset.choice;
  else if(b.dataset.concept!==undefined){state.lesson=+b.dataset.concept;persist();navigate('learn');return;}
  else if(b.dataset.review){if(!wrongIds().includes(b.dataset.review))return;reviewId=b.dataset.review;reviewResult=null;selected=null;}
  else {
    const indices=lessonIndices(),scoped=unitQuestions();
    switch(b.dataset.action){
      case 'prev':state.lesson=indices[Math.max(0,indices.indexOf(state.lesson)-1)];persist();break;
      case 'complete':{
        if(!indices.includes(state.lesson))return;if(!state.completed.includes(state.lesson))state.completed.push(state.lesson);
        const n=indices.indexOf(state.lesson);if(n<indices.length-1)state.lesson=indices[n+1];else{persist();navigate('quiz');return;}persist();break;
      }
      case 'submit':{
        const q=questions[state.quizIndex];if(selected===null||!scoped.includes(q)||q.id in state.answers)return;
        state.answers[q.id]=selected;if(selected!==q.answer&&!state.wrong.includes(q.id))state.wrong.push(q.id);persist();selected=null;break;
      }
      case 'previous-question':state.quizIndex=questions.indexOf(scoped[Math.max(0,scoped.indexOf(questions[state.quizIndex])-1)]);selected=null;persist();break;
      case 'next':{const n=scoped.indexOf(questions[state.quizIndex]);if(n<scoped.length-1)state.quizIndex=questions.indexOf(scoped[n+1]);else quizSummary=true;selected=null;persist();break;}
      case 'review-submit':{if(selected===null)return;const q=scoped.find(q=>q.id===reviewId);if(!q)return;reviewResult=selected;if(selected===q.answer&&!state.resolved.includes(q.id))state.resolved.push(q.id);persist();break;}
      case 'review-list':reviewId=null;reviewResult=null;selected=null;break;
    }
  }
  render();
});
window.addEventListener('hashchange',()=>{clearActivity();render();window.scrollTo(0,0);main.focus({preventScroll:true});});
document.getElementById('reset').addEventListener('click',()=>{
  if(!activeUnit()||!confirm(`‘${activeUnit().title}’ 단원의 개념 진도, 답안, 오답 기록을 초기화할까요? 다른 단원의 기록은 유지됩니다.`))return;
  const indices=lessonIndices(),ids=new Set(unitQuestions().map(q=>q.id));
  state.completed=state.completed.filter(i=>!indices.includes(i));for(const id of ids)delete state.answers[id];
  state.wrong=state.wrong.filter(id=>!ids.has(id));state.resolved=state.resolved.filter(id=>!ids.has(id));delete state.positions[state.selectedUnitId];
  state.lesson=-1;state.quizIndex=-1;normalizeSelection(state);clearActivity();persist();render();
});
function installContent(data,savedProgress){
  if(!data||!Array.isArray(data.lessons)||!Array.isArray(data.questions))throw Error('사용할 수 있는 콘텐츠 형식이 아닙니다.');
  subjects=data.subjects??[{id:DEFAULT_SUBJECT,title:'데이터 이해'}];
  units=data.units??[{id:DEFAULT_UNIT,subject_id:DEFAULT_SUBJECT,title:'데이터와 정보'}];
  lessons=data.lessons.map(l=>({...l,unit_id:l.unit_id??DEFAULT_UNIT}));
  questions=data.questions.map(q=>({...q,lesson:q.lesson_id?lessons.findIndex(l=>l.id===q.lesson_id):q.lesson}));
  try{state=sanitize(savedProgress===undefined?JSON.parse(localStorage.getItem(KEY)):savedProgress);}catch{storageOK=false;state=normalizeSelection(fresh());}
  render();
}
async function loadContent(){
  try{const response=await fetch('/api/content',{cache:'no-store'});if(!response.ok)throw Error('콘텐츠를 불러올 수 없습니다.');installContent(await response.json());return true;}
  catch{main.innerHTML='<section class="panel"><h2>학습 콘텐츠에 연결하지 못했습니다.</h2><p>프로젝트 폴더에서 npm start 실행 후 http://127.0.0.1:4173 으로 접속하고 새로고침해 주세요.</p></section>';return false;}
}
render();
if(typeof fetch==='function')window.contentReady=loadContent();
