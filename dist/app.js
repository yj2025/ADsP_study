'use strict';
const KEY='adsp-study-v1';
const DEFAULT_SUBJECT='data-understanding',DEFAULT_UNIT='data-information';
let subjects=[],units=[],lessons=[],questions=[];
let storageOK=true,state=fresh();
let selected=null,reviewId=null,reviewResult=null,quizSummary=false;
let quizSetup=false;
let contentLoadFailed=false;
const main=document.getElementById('main');

function fresh(){return {version:1,completed:[],lesson:0,answers:{},wrong:[],resolved:[],quizIndex:0,selectedSubjectId:DEFAULT_SUBJECT,selectedUnitId:DEFAULT_UNIT,positions:{},quizRounds:{},mistakes:{},exam:null};}
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
  const visibleIds=new Set(questions.map(q=>q.id));
  const hiddenEntries=entries=>Object.fromEntries(Object.entries(entries??{}).filter(([id])=>!visibleIds.has(id)));
  s.hiddenQuestionRecords={answers:hiddenEntries(value.answers),mistakes:hiddenEntries(value.mistakes),
    resolved:Array.isArray(value.resolved)?value.resolved.filter(id=>typeof id==='string'&&!visibleIds.has(id)):[]};
  s.completed=[...new Set((Array.isArray(value.completed)?value.completed:[]).filter(n=>Number.isInteger(n)&&n>=0&&n<lessons.length))];
  s.lesson=Number.isInteger(value.lesson)&&value.lesson>=0&&value.lesson<lessons.length?value.lesson:0;
  s.quizIndex=Number.isInteger(value.quizIndex)&&value.quizIndex>=0&&value.quizIndex<questions.length?value.quizIndex:0;
  for(const q of questions){const a=value.answers?.[q.id];if(Number.isInteger(a)&&a>=0&&a<4)s.answers[q.id]=a;}
  s.wrong=questions.filter(q=>q.id in s.answers&&s.answers[q.id]!==q.answer).map(q=>q.id);
  for(const q of questions){
    const raw=value.mistakes?.[q.id],count=Math.max(s.wrong.includes(q.id)?1:0,Number.isSafeInteger(raw?.count)?Math.min(raw.count,999999):0);
    if(count)s.mistakes[q.id]={count,memo:typeof raw?.memo==='string'?raw.memo.slice(0,300):'',lastWrong:Number.isSafeInteger(raw?.lastWrong)&&raw.lastWrong>0?raw.lastWrong:0};
  }
  s.resolved=[...new Set((Array.isArray(value.resolved)?value.resolved:[]).filter(id=>Object.hasOwn(s.mistakes,id)))];
  if(Array.isArray(value.completedIds))s.completed=[...new Set(value.completedIds.map(id=>lessons.findIndex(l=>l.id===id)).filter(i=>i>=0))];
  if(value.lessonId){const i=lessons.findIndex(l=>l.id===value.lessonId);if(i>=0)s.lesson=i;}
  if(value.questionId){const i=questions.findIndex(q=>q.id===value.questionId);if(i>=0)s.quizIndex=i;}
  for(const unit of units){const p=value.positions?.[unit.id];if(p&&typeof p==='object')s.positions[unit.id]={lessonId:lessons.find(l=>l.id===p.lessonId&&l.unit_id===unit.id)?.id,questionId:unitQuestions(unit.id).find(q=>q.id===p.questionId)?.id};}
  for(const unit of units){
    const round=value.quizRounds?.[unit.id],pool=new Map(unitQuestions(unit.id).map(q=>[q.id,q]));
    if(!Array.isArray(round?.ids)||!round.ids.length||new Set(round.ids).size!==round.ids.length||!round.ids.every(id=>pool.has(id)))continue;
    const answers={};let firstUnanswered=round.ids.length;
    for(const [i,id] of round.ids.entries()){
      const a=round.answers?.[id];if(!Number.isInteger(a)||a<0||a>=pool.get(id).options.length){firstUnanswered=i;break;}
      answers[id]=a;
    }
    const index=Number.isInteger(round.index)?Math.max(0,Math.min(round.index,firstUnanswered,round.ids.length-1)):0;
    s.quizRounds[unit.id]={ids:round.ids.slice(),answers,index,finished:round.finished===true&&firstUnanswered===round.ids.length,random:round.random===true};
  }
  const savedUnit=units.find(u=>u.id===value.selectedUnitId),savedSubject=subjects.find(v=>v.id===value.selectedSubjectId);
  if(savedUnit){s.selectedUnitId=savedUnit.id;s.selectedSubjectId=savedUnit.subject_id;}
  else if(savedSubject){s.selectedSubjectId=savedSubject.id;s.selectedUnitId=null;}
  else{const unit=units.find(u=>u.id===lessons[s.lesson]?.unit_id);if(unit){s.selectedUnitId=unit.id;s.selectedSubjectId=unit.subject_id;}}
  s.exam=restoreExam(value.exam);
  return normalizeSelection(s);
}
function rememberPosition(){if(state.selectedUnitId)state.positions[state.selectedUnitId]={lessonId:lessons[state.lesson]?.id,questionId:questions[state.quizIndex]?.id};}
function progressSnapshot(){
  rememberPosition();
  const {hiddenQuestionRecords:hidden,...snapshot}=state;
  return {...snapshot,answers:{...hidden?.answers,...state.answers},mistakes:{...hidden?.mistakes,...state.mistakes},
    resolved:[...(hidden?.resolved??[]),...state.resolved],completedIds:state.completed.map(i=>lessons[i].id),
    lessonId:lessons[state.lesson]?.id,questionId:questions[state.quizIndex]?.id};
}
function persist(){if(window.StudyAuth?.user){window.StudyAuth.save(progressSnapshot());return;}try{localStorage.setItem(KEY,JSON.stringify(progressSnapshot()));storageOK=true;}catch{storageOK=false;}updateSaveStatus();}
function updateSaveStatus(){if(window.StudyAuth?.user){window.StudyAuth.status();return;}document.getElementById('save-status').textContent=storageOK?'● 게스트 · 이 브라우저에 저장':'저장 불가 · 현재 탭에서만 유지';}
function clearActivity(){selected=null;reviewId=null;reviewResult=null;quizSummary=false;quizSetup=false;}
function activeRound(){return state.quizRounds[state.selectedUnitId];}
function startRound(count,random,repeat=false){
  const pool=unitQuestions().map(q=>q.id),prior=activeRound();
  if(!Number.isInteger(count)||count<1||count>pool.length||(repeat&&(!prior||prior.ids.some(id=>!pool.includes(id)))))return false;
  if(random&&!repeat)for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  state.quizRounds[state.selectedUnitId]={ids:repeat?prior.ids.slice():pool.slice(0,count),index:0,answers:{},finished:false,random};
  quizSetup=false;selected=null;persist();return true;
}
function recordFirstAnswer(q,choice){
  if(Object.hasOwn(state.answers,q.id))return;
  state.answers[q.id]=choice;
  if(choice!==q.answer&&!state.wrong.includes(q.id))state.wrong.push(q.id);
}
function recordMistake(q){
  const entry=Object.hasOwn(state.mistakes,q.id)?state.mistakes[q.id]:{count:0,memo:'',lastWrong:0};
  state.mistakes[q.id]={...entry,count:Math.min(entry.count+1,999999),lastWrong:Date.now()};
  state.resolved=state.resolved.filter(id=>id!==q.id);
}
function restoreExam(value){
  if(!Array.isArray(value?.ids)||!value.ids.length||value.ids.length>50||new Set(value.ids).size!==value.ids.length||!Number.isSafeInteger(value.deadline)||value.deadline<=0)return null;
  const pool=new Map(questions.map(q=>[q.id,q])),answers={};
  for(const id of value.ids){const q=pool.get(id);if(!q)return null;const choice=value.answers?.[id];if(Number.isInteger(choice)&&choice>=0&&choice<q.options.length)answers[id]=choice;}
  return {ids:value.ids.slice(),answers,deadline:value.deadline,index:Number.isInteger(value.index)?Math.max(0,Math.min(value.index,value.ids.length-1)):0,submitted:value.submitted===true,timedOut:value.timedOut===true};
}
function examSubject(q){return units.find(u=>u.id===lessons[q.lesson]?.unit_id)?.subject_id;}
function startExam(count,minutes){
  if(state.exam&&!state.exam.submitted)return false;
  if(!Number.isInteger(count)||count<1||count>Math.min(50,questions.length)||!Number.isInteger(minutes)||minutes<1||minutes>90)return false;
  const groups=subjects.map(s=>questions.filter(q=>examSubject(q)===s.id));
  const unassigned=questions.filter(q=>!subjects.some(s=>s.id===examSubject(q)));if(unassigned.length)groups.push(unassigned);
  for(const group of groups)for(let i=group.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[group[i],group[j]]=[group[j],group[i]];}
  const ids=[];while(ids.length<count)for(const group of groups)if(group.length&&ids.length<count)ids.push(group.pop().id);
  state.exam={ids,answers:{},index:0,deadline:Date.now()+minutes*60000,submitted:false,timedOut:false};persist();return true;
}
function finishExam(timedOut=false){
  const exam=state.exam;if(!exam||exam.submitted)return false;
  exam.submitted=true;exam.timedOut=timedOut||Date.now()>=exam.deadline;
  for(const q of questions)if(exam.ids.includes(q.id)&&Object.hasOwn(exam.answers,q.id)){
    const a=exam.answers[q.id];recordFirstAnswer(q,a);if(a!==q.answer)recordMistake(q);
  }
  persist();return true;
}
function examClock(deadline){const seconds=Math.max(0,Math.ceil((deadline-Date.now())/1000));return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function tickExam(){
  if(window.StudyAuth&&!window.StudyAuth.ready)return;
  const exam=state.exam;if(!exam||exam.submitted)return;
  if(Date.now()>=exam.deadline){finishExam(true);if(route()==='exam')render();return;}
  if(route()==='exam'){const clock=document.getElementById('exam-clock');if(clock)clock.textContent=examClock(exam.deadline);}
}
function examPage(){
  const exam=state.exam,max=Math.min(50,questions.length),top=heading('모의고사','공개 문항으로 구성하는 실전 연습 · 제출 후 정답과 해설을 확인하세요.');
  if(!max)return top+'<section class="panel empty">공개된 문제가 없어 모의고사를 시작할 수 없습니다.</section>';
  if(!exam)return top+`<section class="panel question"><h2>모의고사 설정</h2><form id="exam-setup"><div class="review-controls"><label>문제 수<input name="count" type="number" min="1" max="${max}" value="${max}" required></label><label>제한 시간(분)<input name="minutes" type="number" min="1" max="90" value="${Math.min(90,max*2)}" required></label></div><p class="note">문제가 있는 과목에서 번갈아 무작위로 출제합니다. 화면을 떠나거나 새로고침해도 시간이 계속 흐릅니다.</p><button type="submit" class="btn">모의고사 시작 →</button></form></section>`;
  const pool=new Map(questions.map(q=>[q.id,q])),items=exam.ids.map(id=>pool.get(id)).filter(Boolean);
  if(exam.submitted){
    const stats=items=>{let right=0,blank=0;for(const q of items){if(!Object.hasOwn(exam.answers,q.id))blank++;else if(exam.answers[q.id]===q.answer)right++;}return {right,blank,wrong:items.length-right-blank};};
    const total=stats(items),score=Math.round(total.right/items.length*100);
    return top+`<section class="panel"><h2>${exam.timedOut?'시간 종료 · 자동 제출':'제출 완료'} · ${score}점</h2><p>정답 ${total.right}개 · 오답 ${total.wrong}개 · 미응답 ${total.blank}개</p><div class="admin-preview"><table><thead><tr><th>과목</th><th>출제</th><th>정답</th><th>오답</th><th>미응답</th></tr></thead><tbody>${subjects.map(s=>{const scoped=items.filter(q=>examSubject(q)===s.id),r=stats(scoped);return `<tr><td>${s.title}</td><td>${scoped.length}</td><td>${r.right}</td><td>${r.wrong}</td><td>${r.blank}</td></tr>`;}).join('')}</tbody></table></div><p class="note">응답해서 틀린 문항은 각 단원의 오답 노트에 추가됩니다.</p><div class="actions"><button class="btn" data-action="exam-new">새 모의고사</button><a class="btn secondary" href="#review">오답 노트</a></div></section>${items.map((q,i)=>{const a=exam.answers[q.id];return `<details class="panel review-item"><summary>${i+1}. ${q.text} · ${a===undefined?'미응답':a===q.answer?'정답':'오답'}</summary><p>내 답: ${a===undefined?'미응답':q.options[a]}</p><p>정답: ${q.options[q.answer]}</p><p>${q.explanation}</p>${a!==undefined&&a!==q.answer?`<button class="btn secondary" data-exam-review="${q.id}">이 문제의 오답 노트로 →</button>`:''}</details>`;}).join('')}`;
  }
  const q=items[exam.index];if(!q)return top;
  return top+`<section class="panel question"><div class="section-title"><span>응답 ${Object.keys(exam.answers).length} / ${exam.ids.length} · 문제 ${exam.index+1}</span><strong>남은 시간 <span id="exam-clock">${examClock(exam.deadline)}</span></strong></div><div class="lesson-tabs" aria-label="문제 이동">${exam.ids.map((id,i)=>`<button type="button" data-exam-index="${i}" class="${i===exam.index?'active':''}" aria-label="${i+1}번 ${Object.hasOwn(exam.answers,id)?'응답함':'미응답'}" aria-pressed="${i===exam.index}">${i+1}${Object.hasOwn(exam.answers,id)?' ✓':''}</button>`).join('')}</div><h2>${q.text}</h2><div class="options" role="group" aria-label="답안 선택">${q.options.map((o,i)=>`<button type="button" class="option ${exam.answers[q.id]===i?'selected':''}" data-exam-choice="${i}" aria-pressed="${exam.answers[q.id]===i}"><span>${i+1}</span>${o}</button>`).join('')}</div><div class="actions"><button class="btn secondary" data-exam-index="${exam.index-1}" ${exam.index===0?'disabled':''}>← 이전</button><button class="btn secondary" data-exam-index="${exam.index+1}" ${exam.index===items.length-1?'disabled':''}>다음 →</button><button class="btn" data-action="exam-submit">시험 제출</button></div></section>`;
}
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
function reviewIds(unitId=state.selectedUnitId){return unitQuestions(unitId).filter(q=>Object.hasOwn(state.mistakes,q.id)).map(q=>q.id);}
function pending(unitId=state.selectedUnitId){return reviewIds(unitId).filter(id=>!state.resolved.includes(id));}
function recommended(){return pending().sort((a,b)=>state.mistakes[b].count-state.mistakes[a].count||state.mistakes[b].lastWrong-state.mistakes[a].lastWrong);}
const escapeMemo=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function memoForm(id){return `<form class="review-memo" data-memo-id="${id}"><label>오답 이유 메모<textarea name="memo" maxlength="300" rows="2" placeholder="예: 지지도와 신뢰도의 분모를 혼동했어요.">${escapeMemo(state.mistakes[id].memo)}</textarea></label><button type="submit" class="btn secondary">메모 저장</button><span role="status" data-memo-status></span></form>`;}
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
  const scoped=unitQuestions(),isReview=mode==='review',round=mode==='round'?activeRound():null,a=isReview?reviewResult:round?round.answers[q.id]:state.answers[q.id],submitted=Number.isInteger(a),n=round?round.index:scoped.indexOf(q),total=round?round.ids.length:scoped.length;
  return `<section class="panel question"><div class="section-title"><span class="pill">${lessons[q.lesson].title}</span><span>${isReview?'오답 재풀이':`QUESTION ${n+1} / ${total}`}</span></div>${!isReview?`<div class="bar"><i style="width:${(round?Object.keys(round.answers).length:answered())/total*100}%"></i></div>`:''}<h2>${q.text}</h2><div class="options" role="group" aria-label="답안 선택">${q.options.map((o,j)=>`<button class="option ${submitted?(j===q.answer?'correct':j===a?'incorrect':''):selected===j?'selected':''}" data-choice="${j}" aria-pressed="${selected===j||a===j}" ${submitted?'disabled':''}><span>${j+1}</span>${o}${submitted&&j===q.answer?' ✓':''}</button>`).join('')}</div>${submitted?`<div class="feedback ${a!==q.answer?'wrong':''}" role="status"><strong>${a===q.answer?'정답입니다!':`아쉬워요. 정답은 ${q.answer+1}번입니다.`}</strong><p>${q.explanation}</p><button class="btn secondary" data-concept="${q.lesson}" style="margin-top:12px">관련 개념 다시 보기 ↗</button></div>`:''}<div class="actions">${isReview?'<button class="btn secondary" data-action="review-list">목록으로</button>':`<button class="btn secondary" data-action="previous-question" ${n===0?'disabled':''}>← 이전 문제</button>`}${submitted?`<button class="btn" data-action="${isReview?'review-list':'next'}">${isReview?(a===q.answer?'복습 완료 · 목록으로':'목록에서 다시 도전'):(n===total-1?'학습 결과 보기':'다음 문제 →')}</button>`:`<button class="btn" data-action="${isReview?'review-submit':'submit'}" ${selected===null?'disabled':''}>정답 확인</button>`}</div></section>`;
}
function quiz(){
  const scoped=unitQuestions();
  if(!scoped.length)return heading('배운 내용을 내 것으로.',pathLabel())+emptyPanel('quiz');
  const top=heading('배운 내용을 내 것으로.',`${pathLabel()} · 공개 문제 ${scoped.length}개`),round=activeRound();
  if(!round||quizSetup)return top+`<section class="panel question"><h2>이번에 풀 문제를 골라보세요.</h2><form id="quiz-setup"><div class="review-controls"><label>문제 수 <input name="count" type="number" min="1" max="${scoped.length}" value="${round?.ids.length??Math.min(10,scoped.length)}" required></label><label>출제 순서 <select name="order"><option value="random" ${round?.random!==false?'selected':''}>무작위 출제</option><option value="ordered" ${round?.random===false?'selected':''}>등록 순서</option></select></label></div><p class="muted">1~${scoped.length}개를 선택할 수 있습니다. 한 세트 안에서 같은 문제가 중복되지 않습니다.</p>${round?'<p class="note">새 세트를 시작하면 이 단원의 이전 세트가 교체됩니다. 첫 풀이 기록과 오답 노트는 유지됩니다.</p>':''}<div class="actions">${round?'<button type="button" class="btn secondary" data-action="round-resume">이전 세트로 돌아가기</button>':''}<button class="btn" type="submit">문제 풀이 시작 →</button></div></form></section>`;
  const pool=new Map(scoped.map(q=>[q.id,q])),missed=round.ids.filter(id=>round.answers[id]!==pool.get(id)?.answer);
  if(round.finished)return top+`<section class="panel empty"><span class="eyebrow">UNIT RESULT</span><h2>이번 세트 결과</h2><div class="result-score">${round.ids.length-missed.length}<small style="font-size:20px"> / ${round.ids.length}</small></div><p>정답 ${round.ids.length-missed.length}개 · 오답 ${missed.length}개</p>${missed.length?`<details><summary>이번 세트에서 틀린 문제</summary><ol>${missed.map(id=>`<li>${pool.get(id).text}</li>`).join('')}</ol></details>`:''}<p class="note">단원 진도와 오답 노트는 각 문제의 첫 풀이를 기준으로 기록됩니다.</p><div class="actions"><button class="btn secondary" data-action="round-repeat">같은 문제 다시 풀기</button><button class="btn" data-action="round-setup">새 세트 만들기 →</button><a class="btn secondary" href="#review">오답 노트</a></div></section>`;
  const q=pool.get(round.ids[round.index]);
  if(!q)return top+'<button class="btn" data-action="round-setup">새 세트 만들기</button>';
  return top+`<div class="section-title"><span>${round.random?'무작위 출제':'등록 순서'} · ${Object.keys(round.answers).length} / ${round.ids.length}문제 응답</span><button class="btn secondary" data-action="round-setup">새 세트</button></div>`+questionCard(q,'round');
}
function review(){
  if(reviewId)return heading('다시 풀며, 더 단단하게.',pathLabel())+questionCard(questions.find(q=>q.id===reviewId),'review')+(reviewResult!==null?`<section class="panel question">${memoForm(reviewId)}</section>`:'');
  const queue=recommended(),resolved=reviewIds().filter(id=>state.resolved.includes(id)),wrong=[...queue,...resolved];
  return heading('틀린 문제에서 실력이 자라요.',`${pathLabel()} · 오답이 많은 문제부터, 횟수가 같으면 최근 오답부터 추천합니다.`)+`<div class="section-title"><h2>복습 대기 ${queue.length}문제</h2><span>복습 완료 ${resolved.length}문제</span></div>${queue.length?`<div class="actions"><button class="btn" data-review="${queue[0]}">추천 문제 복습하기 →</button></div>`:''}${!wrong.length?`<section class="panel empty"><div class="symbol">✓</div><h2>이 단원에는 모인 오답이 없어요.</h2><a class="btn" href="#quiz">문제 풀러 가기 →</a></section>`:wrong.map(id=>{const q=questions.find(q=>q.id===id),done=state.resolved.includes(id),entry=state.mistakes[id];return `<article class="panel review-item"><div class="section-title"><span class="pill">${done?'✓ 복습 완료':id===queue[0]?'추천 복습':'↻ 복습 대기'} · ${lessons[q.lesson].title}</span><span class="${entry.count>=2?'repeat-mistake':''}">${entry.count>=2?'반복 오답 · ':''}${entry.count}회 틀림</span></div><h3>${q.text}</h3><p class="muted">첫 선택: ${q.options[state.answers[id]]}</p><button class="btn ${done?'secondary':''}" data-review="${id}">${done?'다시 연습하기':'정답 가리고 재풀이'} →</button>${memoForm(id)}</article>`;}).join('')}`;
}
function route(){const name=location.hash.slice(1);return ['learn','quiz','review','exam','admin'].includes(name)?name:'home';}
function render(){
  if(!subjects.length){
    main.innerHTML=contentLoadFailed
      ?'<section class="panel"><h2>학습 콘텐츠를 불러오지 못했어요.</h2><p>인터넷 연결을 확인하고 다시 시도해 주세요.</p><button type="button" class="btn" data-action="retry-content">다시 시도</button></section>'
      :'<section class="panel" role="status">학습 콘텐츠를 불러오는 중입니다.</section>';
    return;
  }
  const r=route();main.innerHTML=r==='admin'?(window.ContentAdmin?.render()??'<section class="panel" role="status">관리자 화면을 불러오는 중입니다.</section>'):(!storageOK?'<div class="notice">브라우저 저장소를 사용할 수 없어 기록이 현재 탭에서만 유지됩니다.</div>':'')+(r==='exam'?examPage():scopePicker()+({home,learn,quiz,review}[r])());
  document.getElementById('reset').hidden=r==='admin'||r==='exam';
  if(r==='admin'&&window.StudyAuth?.user?.role==='admin'&&window.ContentReview)main.insertAdjacentHTML('beforeend',window.ContentReview.render());
  document.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===r));
  document.getElementById('breadcrumb').textContent=r==='admin'?'관리자 / 콘텐츠 관리':`${activeSubject()?.title??''} / ${activeUnit()?.title??'단원 선택'} / ${{home:'대시보드',learn:'개념 학습',quiz:'문제 풀이',review:'오답 노트',exam:'모의고사'}[r]}`;
  document.getElementById('wrong-badge').textContent=pending().length;
  document.getElementById('curriculum-nav').innerHTML=subjects.map((s,i)=>`<button class="subject-button ${s.id===state.selectedSubjectId?'active':''}" data-subject="${s.id}" aria-pressed="${s.id===state.selectedSubjectId}"><span>${String(i+1).padStart(2,'0')}</span>${s.title}<small>${units.filter(u=>u.subject_id===s.id).length}개 단원</small></button>`).join('');
  updateSaveStatus();
}
function renderWithFocus(selector='.question h2'){
  render();
  const target=main.querySelector(selector);
  if(target?.tagName==='H2')target.tabIndex=-1;
  (target??main).focus();
}
function navigate(name){if(location.hash===`#${name}`)render();else location.hash=name;}
main.addEventListener('change',e=>{if(e.target.id==='subject-select')chooseSubject(e.target.value);if(e.target.id==='unit-select')chooseUnit(e.target.value);});
main.addEventListener('submit',e=>{
  if(route()==='exam'&&e.target.id==='exam-setup'){
    e.preventDefault();if(startExam(Number(e.target.elements.count.value),Number(e.target.elements.minutes.value)))renderWithFocus();return;
  }
  if(route()==='review'&&e.target.dataset.memoId){
    e.preventDefault();const id=e.target.dataset.memoId;if(!reviewIds().includes(id))return;
    state.mistakes[id].memo=e.target.elements.memo.value.trim().slice(0,300);persist();
    e.target.querySelector('[data-memo-status]').textContent=window.StudyAuth?.user?'계정에 저장 요청됨':storageOK?'메모 저장됨':'현재 탭에만 보관됨';return;
  }
  if(route()!=='quiz'||e.target.id!=='quiz-setup')return;
  e.preventDefault();
  if(startRound(Number(e.target.elements.count.value),e.target.elements.order.value==='random'))renderWithFocus();
});
document.getElementById('curriculum-nav').addEventListener('click',e=>{const b=e.target.closest('[data-subject]');if(b)chooseSubject(b.dataset.subject);});
main.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.action==='retry-content'&&contentLoadFailed){location.reload();return;}
  if(route()==='admin')return;
  if(route()==='exam'){
    if(b.type==='submit')return;
    const exam=state.exam;if(!exam)return;
    if(!exam.submitted&&Date.now()>=exam.deadline){finishExam(true);renderWithFocus();return;}
    if(b.dataset.action==='exam-new'&&exam.submitted){state.exam=null;persist();}
    else if(b.dataset.action==='exam-submit'&&!exam.submitted){
      const blank=exam.ids.length-Object.keys(exam.answers).length;
      if(!confirm(blank?`미응답 ${blank}문제가 있습니다. 제출할까요?`:'모의고사를 제출할까요?'))return;
      finishExam();
    }else if(b.dataset.examReview&&exam.submitted){
      const q=questions.find(q=>q.id===b.dataset.examReview&&exam.ids.includes(q.id));if(!q)return;
      chooseUnit(lessons[q.lesson].unit_id);navigate('review');return;
    }else if(!exam.submitted&&b.dataset.examIndex!==undefined){
      const i=Number(b.dataset.examIndex);if(!Number.isInteger(i)||i<0||i>=exam.ids.length)return;exam.index=i;persist();
    }else if(!exam.submitted&&b.dataset.examChoice!==undefined){
      const q=questions.find(q=>q.id===exam.ids[exam.index]),a=Number(b.dataset.examChoice);
      if(!q||!Number.isInteger(a)||a<0||a>=q.options.length)return;exam.answers[q.id]=a;persist();
    }else return;
    renderWithFocus(b.dataset.examChoice!==undefined?'[data-exam-choice][aria-pressed="true"]':undefined);return;
  }
  if(b.type==='submit'&&(b.form?.id==='quiz-setup'||b.form?.dataset.memoId))return;
  if(b.dataset.unit){chooseUnit(b.dataset.unit);return;}
  if(b.dataset.lesson!==undefined){if(!lessonIndices().includes(+b.dataset.lesson))return;state.lesson=+b.dataset.lesson;persist();}
  else if(b.dataset.choice!==undefined)selected=+b.dataset.choice;
  else if(b.dataset.concept!==undefined){state.lesson=+b.dataset.concept;persist();navigate('learn');return;}
  else if(b.dataset.review){if(!reviewIds().includes(b.dataset.review))return;reviewId=b.dataset.review;reviewResult=null;selected=null;}
  else {
    const indices=lessonIndices(),scoped=unitQuestions();
    const round=route()==='quiz'?activeRound():null;
    switch(b.dataset.action){
      case 'round-setup':quizSetup=true;selected=null;break;
      case 'round-resume':quizSetup=false;selected=null;break;
      case 'round-repeat':if(round?.finished)startRound(round.ids.length,round.random,true);break;
      case 'prev':state.lesson=indices[Math.max(0,indices.indexOf(state.lesson)-1)];persist();break;
      case 'complete':{
        if(!indices.includes(state.lesson))return;if(!state.completed.includes(state.lesson))state.completed.push(state.lesson);
        const n=indices.indexOf(state.lesson);if(n<indices.length-1)state.lesson=indices[n+1];else{persist();navigate('quiz');return;}persist();break;
      }
      case 'submit':{
        if(round){
          const q=scoped.find(item=>item.id===round.ids[round.index]);
          if(!q||round.finished||Object.hasOwn(round.answers,q.id)||!Number.isInteger(selected)||selected<0||selected>=q.options.length)return;
          round.answers[q.id]=selected;recordFirstAnswer(q,selected);if(selected!==q.answer)recordMistake(q);selected=null;persist();break;
        }
        const q=questions[state.quizIndex];if(selected===null||!scoped.includes(q)||q.id in state.answers)return;
        recordFirstAnswer(q,selected);if(selected!==q.answer)recordMistake(q);persist();selected=null;break;
      }
      case 'previous-question':if(round)round.index=Math.max(0,round.index-1);else state.quizIndex=questions.indexOf(scoped[Math.max(0,scoped.indexOf(questions[state.quizIndex])-1)]);selected=null;persist();break;
      case 'next':{
        if(round){if(!Object.hasOwn(round.answers,round.ids[round.index]))return;if(round.index<round.ids.length-1)round.index++;else round.finished=true;}
        else{const n=scoped.indexOf(questions[state.quizIndex]);if(n<scoped.length-1)state.quizIndex=questions.indexOf(scoped[n+1]);else quizSummary=true;}
        selected=null;persist();break;
      }
      case 'review-submit':{if(selected===null||reviewResult!==null)return;const q=scoped.find(q=>q.id===reviewId);if(!q)return;reviewResult=selected;if(selected!==q.answer)recordMistake(q);else if(!state.resolved.includes(q.id))state.resolved.push(q.id);persist();break;}
      case 'review-list':reviewId=null;reviewResult=null;selected=null;break;
    }
  }
  renderWithFocus(b.dataset.choice!==undefined?'[data-choice][aria-pressed="true"]':undefined);
});
window.addEventListener('hashchange',()=>{clearActivity();render();window.scrollTo(0,0);main.focus({preventScroll:true});});
document.getElementById('reset').addEventListener('click',()=>{
  if(!activeUnit()||!confirm(`‘${activeUnit().title}’ 단원의 개념 진도, 답안, 오답 기록을 초기화할까요? 다른 단원의 기록은 유지됩니다.`))return;
  const indices=lessonIndices(),ids=new Set(unitQuestions().map(q=>q.id));
  state.completed=state.completed.filter(i=>!indices.includes(i));for(const id of ids)delete state.answers[id];
  state.wrong=state.wrong.filter(id=>!ids.has(id));state.resolved=state.resolved.filter(id=>!ids.has(id));delete state.positions[state.selectedUnitId];
  delete state.quizRounds[state.selectedUnitId];
  for(const id of ids)delete state.mistakes[id];
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
  catch{contentLoadFailed=true;render();return false;}
}
render();
if(typeof setInterval==='function')setInterval(tickExam,250);
if(typeof fetch==='function')window.contentReady=loadContent();
