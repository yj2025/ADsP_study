'use strict';
(() => {
  let owner,unitId,status,items,selection,busy,message,error;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const admin=()=>window.StudyAuth?.user;
  const available=()=>route()==='admin'&&admin()?.role==='admin';
  const key=item=>`${item.type}:${item.id}`;
  function reset(){owner=admin()?.id;unitId=activeUnit()?.id??units[0]?.id;status='draft';items=null;selection=new Set();busy=false;message='';error='';}
  function draw(){if(available())render();}
  async function api(url,data){
    const response=await fetch(url,data?{method:'POST',headers:{'Content-Type':'application/json','X-Study-User':String(admin()?.id)},body:JSON.stringify(data)}:{cache:'no-store'});
    const payload=await response.json();if(response.status===401&&payload.code==='SESSION_EXPIRED')window.StudyAuth?.expire();if(!response.ok)throw Error(payload.error);return payload;
  }
  function questionControls(item){
    if(item.type!=='question')return '';
    if(status==='published')return `<button type="button" class="btn secondary" data-review-action="withdraw" data-question-id="${esc(item.id)}" ${busy?'disabled':''}>공개 내리기</button>`;
    return `<details><summary>문제 수정</summary><form data-edit-question="${esc(item.id)}">
      <label>문제<textarea name="text" required maxlength="10000">${esc(item.title)}</textarea></label>
      ${item.options.map((option,index)=>`<label>보기 ${index+1}<input name="option${index}" value="${esc(option)}" required maxlength="2000"></label>`).join('')}
      <label>정답<select name="answer">${item.options.map((_,index)=>`<option value="${index}" ${index===item.answer?'selected':''}>${index+1}번</option>`).join('')}</select></label>
      <label>해설<textarea name="explanation" required maxlength="20000">${esc(item.explanation)}</textarea></label>
      <button type="submit" class="btn secondary" ${busy?'disabled':''}>초안 수정 저장</button></form></details>`;
  }
  function card(item){
    const id=key(item),date=item.reviewed_at?new Date(item.reviewed_at).toLocaleString('ko-KR'):null;
    return `<article class="review-entry"><div class="review-entry-title">${status==='draft'?`<label><input type="checkbox" data-review-pick="${esc(id)}" ${selection.has(id)?'checked':''} ${busy?'disabled':''}> <span>공개 선택</span></label>`:''}<span class="pill">${item.type==='lesson'?'개념':'문제'}</span><code>${esc(item.id)}</code></div><details><summary>${esc(item.title)}</summary>${item.type==='lesson'?`<p class="content-text">${esc(item.body)}</p>`:`<p class="muted">연결 개념: ${esc(item.lesson_title)} (${esc(item.lesson_id)})</p><ol>${item.options.map((o,i)=>`<li>${esc(o)}${i===item.answer?' <strong>✓ 정답</strong>':''}</li>`).join('')}</ol><p class="content-text"><strong>해설</strong><br>${esc(item.explanation)}</p>`}${item.source_url?`<p>출처: ${esc(item.source_url)}</p>`:''}${item.license?`<p>이용 조건: ${esc(item.license)}</p>`:''}</details>${status==='published'?`<small class="muted">${date?`공개 완료 · ${esc(date)}`:'기존 공개 콘텐츠'}</small>`:''}${questionControls(item)}</article>`;
  }
  function panel(){
    if(owner!==admin()?.id||!selection)reset();
    return `<section class="panel review-panel" id="content-review"><div class="section-title"><h2>3. 콘텐츠 검수와 공개</h2><span>초안 → 공개 완료</span></div><p class="muted">개념 본문과 문제의 보기·정답·해설을 확인하세요. 공개한 콘텐츠만 학습 화면에 표시됩니다.</p><div class="review-controls"><label>검수할 단원<select id="review-unit" ${busy?'disabled':''}>${subjects.map(s=>`<optgroup label="${s.title}">${units.filter(u=>u.subject_id===s.id).map(u=>`<option value="${u.id}" ${u.id===unitId?'selected':''}>${u.title}</option>`).join('')}</optgroup>`).join('')}</select></label><label>검수 상태<select id="review-status" ${busy?'disabled':''}><option value="draft" ${status==='draft'?'selected':''}>초안</option><option value="published" ${status==='published'?'selected':''}>공개 완료</option></select></label><button type="button" class="btn secondary" data-review-action="load" ${busy||!unitId?'disabled':''}>목록 불러오기</button></div>${error?`<p class="admin-error" role="alert">${esc(error)}</p>`:''}${message?`<p class="admin-success" role="status">${esc(message)}</p>`:''}${busy?'<p role="status">처리 중입니다…</p>':''}${items?items.length?`<div class="review-items">${items.map(card).join('')}</div>`:'<p class="muted">이 단원에 해당 상태의 콘텐츠가 없습니다.</p>':'<p class="muted">단원과 상태를 선택한 뒤 목록을 불러오세요.</p>'}${status==='draft'&&items?.length?`<div class="actions"><span id="review-selection" aria-live="polite">${selection.size}개 선택</span><button type="button" id="review-publish" class="btn" data-review-action="publish" ${!selection.size||busy?'disabled':''}>검수 완료 및 공개</button></div>`:''}</section>`;
  }
  async function load(){
    const account=owner;
    const result=await api(`/api/admin/content/review?${new URLSearchParams({unit_id:unitId,status})}`);
    if(account===admin()?.id){items=result.items;selection.clear();}
  }
  async function run(action){
    if(busy)return;const account=owner;busy=true;error='';message='';draw();
    try{await action();}catch(e){if(account===admin()?.id)error=e.message||'요청을 처리하지 못했습니다.';}
    finally{if(account===admin()?.id){busy=false;draw();}}
  }
  window.ContentReview={render:panel,open(id){if(owner!==admin()?.id||!selection)reset();if(busy)return;unitId=id;status='draft';items=null;selection.clear();run(load);document.getElementById('content-review')?.scrollIntoView();}};
  main.addEventListener('change',e=>{
    if(!available()||busy)return;
    if(e.target.id==='review-unit'||e.target.id==='review-status'){
      if(e.target.id==='review-unit')unitId=e.target.value;else status=e.target.value;
      items=null;selection.clear();message='';error='';draw();
    }else if(e.target.dataset.reviewPick){
      const id=e.target.dataset.reviewPick;if(e.target.checked)selection.add(id);else selection.delete(id);
      document.getElementById('review-selection').textContent=`${selection.size}개 선택`;
      document.getElementById('review-publish').disabled=!selection.size;
    }
  });
  main.addEventListener('submit',e=>{
    const id=e.target.dataset.editQuestion;
    if(!available()||!id)return;
    e.preventDefault();
    if(busy||status!=='draft')return;
    const fields=e.target.elements;
    const account=owner;
    const changes={text:fields.text.value,options:Array.from({length:4},(_,i)=>fields['option'+i].value),
      answer:Number(fields.answer.value),explanation:fields.explanation.value};
    run(async()=>{
      await api('/api/admin/content/question',{unit_id:unitId,id,action:'edit',changes});
      if(account!==admin()?.id)return;
      await load();message='수정한 초안을 저장했습니다. 검수 후 다시 공개할 수 있습니다.';
    });
  });
  main.addEventListener('click',e=>{
    if(!available()||busy)return;
    const action=e.target.closest('[data-review-action]')?.dataset.reviewAction;
    if(action==='load')run(load);
    if(action==='withdraw'&&status==='published'){
      const id=e.target.closest('[data-question-id]').dataset.questionId;
      if(!confirm('이 문제를 학습 화면에서 내리고 초안으로 되돌릴까요?'))return;
      const account=owner;
      run(async()=>{
        await api('/api/admin/content/question',{unit_id:unitId,id,action:'withdraw'});
        if(account!==admin()?.id)return;
        await load();message='공개를 내렸습니다. 초안 목록에서 수정할 수 있습니다.';
        try{
          const response=await fetch('/api/content',{cache:'no-store'});
          if(!response.ok)throw Error();
          const content=await response.json();
          if(account===admin()?.id)installContent(content,progressSnapshot());
        }catch{error='공개는 내렸습니다. 학습 화면을 갱신하려면 새로고침해 주세요.';}
      });
    }
    if(action==='publish'&&selection.size&&status==='draft'){
      const picked=items.filter(item=>selection.has(key(item))).map(({type,id})=>({type,id}));
      if(!confirm(`선택한 ${picked.length}개 항목을 검수 완료로 표시하고 학습 화면에 공개할까요?`))return;
      const account=owner;
      run(async()=>{
        const {counts}=await api('/api/admin/content/publish',{unit_id:unitId,items:picked});
        if(account!==admin()?.id)return;
        message=`공개 완료: 개념 ${counts.lessons}개 · 문제 ${counts.questions}개`;
        items=null;selection.clear();
        try{const response=await fetch('/api/content',{cache:'no-store'});if(!response.ok)throw Error();const content=await response.json();if(account===admin()?.id)installContent(content,progressSnapshot());}
        catch{error='공개는 완료됐습니다. 학습 화면을 갱신하려면 새로고침해 주세요.';}
        if(account===admin()?.id)await load();
      });
    }
  });
})();
