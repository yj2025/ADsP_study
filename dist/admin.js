'use strict';
(() => {
  const view={filename:'',content:'',subjectId:'',unitId:'',busy:false,report:null,token:null,error:'',saved:null,revision:0,owner:null};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function update(){
    const user=window.StudyAuth?.user;
    document.getElementById('admin-link').hidden=user?.role!=='admin';
    if(view.owner!==user?.id){Object.assign(view,{owner:user?.id,busy:false,filename:'',content:'',subjectId:'',unitId:'',report:null,token:null,error:'',saved:null});view.revision++;}
  }
  function invalidate(){view.token=null;view.report=null;view.error='';view.saved=null;view.revision++;}
  function initializeScope(){
    if(!subjects.some(s=>s.id===view.subjectId))view.subjectId=activeSubject()?.id??subjects[0]?.id??'';
    if(!units.some(u=>u.id===view.unitId&&u.subject_id===view.subjectId))view.unitId=units.find(u=>u.subject_id===view.subjectId)?.id??'';
  }
  function draw(){if(route()==='admin')render();}
  async function request(url,data){
    const response=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Study-User':String(window.StudyAuth?.user?.id??'')},body:JSON.stringify(data)});
    const result=await response.json();
    if(!response.ok&&!result.errors)throw Error(result.error||'요청을 처리하지 못했습니다.');
    return result;
  }
  function renderAdmin(){
    update();
    if(!window.StudyAuth?.ready)return '<section class="panel empty" role="status">로그인 상태를 확인하는 중입니다.</section>';
    if(window.StudyAuth.user?.role!=='admin')return '<section class="panel empty"><span class="eyebrow">ADMIN ACCESS</span><h2>관리자 전용 화면입니다.</h2><p class="muted">관리자로 지정된 계정으로 로그인해 주세요.</p><a class="btn secondary" href="#home">학습 화면으로 돌아가기</a></section>';
    initializeScope();
    const busy=view.busy?'disabled':'',report=view.report;
    const expired=report?.expires_at&&report.expires_at<=Date.now();
    const canSave=view.token&&report?.valid&&!expired&&!view.busy;
    return heading('콘텐츠를 차곡차곡 채워보세요.','관리자 전용 · 파일 업로드 → 과목·단원 지정 → 검증 → 저장')+`<div class="admin-layout"><section class="panel admin-upload"><div class="section-title"><h2>1. 파일과 학습 범위</h2><span>CSV / JSON</span></div><label class="upload-zone" for="admin-file"><span class="upload-icon">↥</span><strong>${view.filename?esc(view.filename):'CSV 또는 JSON 파일을 선택하세요'}</strong><small>UTF-8 · 최대 2MB · 한 번에 최대 1,000개</small><input id="admin-file" type="file" accept=".csv,.json" ${busy}></label><div class="admin-scope"><label for="admin-subject">추가할 과목</label><select id="admin-subject" ${busy}>${subjects.map(s=>`<option value="${s.id}" ${view.subjectId===s.id?'selected':''}>${s.title}</option>`).join('')}</select><label for="admin-unit">추가할 단원</label><select id="admin-unit" ${busy||!view.unitId?'disabled':''}>${units.filter(u=>u.subject_id===view.subjectId).map(u=>`<option value="${u.id}" ${view.unitId===u.id?'selected':''}>${u.title}</option>`).join('')||'<option>등록된 단원 없음</option>'}</select></div><p class="note">파일의 신규 개념은 모두 선택한 단원에 추가합니다. 문제는 같은 단원에 속한 개념만 참조할 수 있습니다. 기존 항목은 덮어쓰지 않습니다.</p><button type="button" class="btn admin-wide" data-admin-action="validate" ${view.content&&view.unitId&&!view.busy?'':'disabled'}>${view.busy==='reading'?'파일을 읽는 중…':view.busy==='validating'?'검증하는 중…':'파일 검증하기 →'}</button><details class="admin-help"><summary>파일 작성 방법</summary><p>JSON은 lessons/questions 배열, CSV는 type=lesson 또는 question 행을 사용합니다. JSON 정답은 0~3, CSV 정답은 1~4입니다.</p><p>새 과목·단원 정의가 있는 파일은 CLI로 가져오세요. 이 화면에서는 등록된 과목·단원을 선택합니다.</p></details></section><section class="panel admin-result"><div class="section-title"><h2>2. 검증 결과 확인</h2><span>저장 전 확인</span></div>${view.error?`<div class="admin-error" role="alert">${esc(view.error)}</div>`:''}${view.saved?`<div class="admin-success" role="status"><strong>콘텐츠 저장 완료</strong><p>개념 ${view.saved.counts.lessons}개 · 문제 ${view.saved.counts.questions}개를 추가했습니다.</p><button class="btn secondary" type="button" data-admin-action="study">추가한 단원 학습하기 →</button></div>`:report?report.valid?`<div class="admin-success" role="status"><strong>✓ 검증을 통과했습니다.</strong><p>${esc(report.unit.subject_title)} / ${esc(report.unit.title)}</p></div><div class="admin-counts"><div><strong>${report.counts.lessons}</strong><small>추가할 개념</small></div><div><strong>${report.counts.questions}</strong><small>추가할 문제</small></div></div>${report.warnings.map(w=>`<p class="notice">${esc(w)}</p>`).join('')}<div class="admin-preview"><table><thead><tr><th>유형</th><th>ID / 제목</th></tr></thead><tbody>${report.preview.map(row=>`<tr><td>${esc(row.type)}</td><td><code>${esc(row.id)}</code><span>${esc(row.title)}</span></td></tr>`).join('')}</tbody></table></div>${report.counts.lessons+report.counts.questions>100?'<p class="note">목록은 처음 100개만 표시합니다. 저장 시 전체 항목이 반영됩니다.</p>':''}<p class="note">${expired?'검증 결과가 만료되었습니다. 다시 검증해 주세요.':'검증 결과는 10분 동안 유효합니다. 파일이나 범위를 바꾸면 다시 검증해야 합니다.'}</p>`:`<div class="admin-error" role="alert"><strong>검증에 실패했습니다.</strong><ul>${report.errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul><p>첫 오류를 수정하고 파일을 다시 선택한 뒤 검증해 주세요. 저장된 콘텐츠는 변경되지 않았습니다.</p></div>`:'<div class="admin-placeholder"><span>✓</span><strong>검증 결과가 이곳에 표시됩니다.</strong><p>파일과 대상 단원을 지정한 뒤 검증을 시작하세요.</p></div>'}<button type="button" class="btn admin-wide" data-admin-action="save" ${canSave?'':'disabled'}>${view.busy==='saving'?'저장하는 중…':'검증한 콘텐츠 저장'}</button></section></div>`;
  }
  window.ContentAdmin={render:renderAdmin,update};
  main.addEventListener('change',async e=>{
    if(route()!=='admin'||view.busy||window.StudyAuth?.user?.role!=='admin')return;
    if(e.target.id==='admin-subject'){invalidate();view.subjectId=e.target.value;view.unitId='';initializeScope();draw();}
    else if(e.target.id==='admin-unit'){invalidate();view.unitId=e.target.value;draw();}
    else if(e.target.id==='admin-file'){
      const file=e.target.files?.[0];if(!file)return;
      invalidate();view.content='';view.filename=file.name;
      if(file.size>2*1024*1024){view.error='파일 크기는 최대 2MB입니다.';draw();return;}
      if(!/\.(csv|json)$/i.test(file.name)){view.error='CSV 또는 JSON 파일을 선택해 주세요.';draw();return;}
      const revision=view.revision;view.busy='reading';draw();
      try{const bytes=await file.arrayBuffer();const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(revision===view.revision)view.content=content;}
      catch{if(revision===view.revision)view.error='파일을 읽지 못했습니다. UTF-8로 저장한 파일인지 확인해 주세요.';}
      finally{if(revision===view.revision){view.busy=false;draw();}}
    }
  });
  main.addEventListener('click',async e=>{
    if(route()!=='admin'||view.busy||window.StudyAuth?.user?.role!=='admin')return;
    const action=e.target.closest('[data-admin-action]')?.dataset.adminAction;
    if(action==='study'&&view.saved){chooseUnit(view.saved.unit_id);navigate('learn');return;}
    if(!['validate','save'].includes(action))return;
    if(action==='validate'&&(!view.content||!view.unitId)||action==='save'&&!view.token)return;
    const revision=view.revision;
    view.busy=action==='validate'?'validating':'saving';view.error='';if(action==='validate'){view.token=null;view.report=null;view.saved=null;}draw();
    try{
      if(action==='validate'){
        const report=await request('/api/admin/content/validate',{filename:view.filename,content:view.content,subject_id:view.subjectId,unit_id:view.unitId});
        if(revision===view.revision){view.report=report;view.token=report.valid?report.validation_token:null;}
      }else{
        const result=await request('/api/admin/content/import',{validation_token:view.token});
        if(revision===view.revision){view.saved=result;view.token=null;view.report=null;
          try{const response=await fetch('/api/content',{cache:'no-store'});if(!response.ok)throw Error();installContent(await response.json(),progressSnapshot());}catch{view.error='저장은 완료됐지만 학습 목록을 갱신하지 못했습니다. 페이지를 새로고침해 주세요.';}
        }
      }
    }catch(error){if(revision===view.revision){view.error=error.message||'서버 연결을 확인한 뒤 다시 시도해 주세요.';if(action==='save')view.token=null;}}
    finally{if(revision===view.revision){view.busy=false;draw();}}
  });
  update();if(route()==='admin')draw();
})();
