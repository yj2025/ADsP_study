'use strict';
(() => {
  const header=document.querySelector('header');
  const accountButton=document.createElement('button');
  accountButton.className='account-button';
  accountButton.textContent='로그인 / 회원가입';
  header.append(accountButton);
  const dialog=document.createElement('dialog');
  dialog.className='auth-dialog';
  dialog.dataset.authMode='login';
  dialog.setAttribute('aria-labelledby','auth-title');
  dialog.innerHTML=`<button class="auth-close" aria-label="닫기" type="button">×</button><span class="eyebrow">MY STUDY ACCOUNT</span><h2 id="auth-title">다시 만나 반가워요.</h2><p class="muted auth-description">로그인하고 나의 학습을 이어가세요.</p><div class="auth-tabs" role="group" aria-label="계정 메뉴"><button type="button" data-mode="login" class="active">로그인</button><button type="button" data-mode="register">회원가입</button></div><form><label>이메일<input name="email" type="email" autocomplete="username" placeholder="you@example.com" maxlength="254" required></label><label>비밀번호<input name="password" type="password" autocomplete="current-password" placeholder="10자 이상, 128자 이하" minlength="10" maxlength="128" required></label><label class="confirm-field" hidden>비밀번호 확인<input name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="128"></label><label class="import-field" hidden><input name="import" type="checkbox"> 이 브라우저의 게스트 학습 기록을 가져오기</label><p class="auth-error" role="alert"></p><button class="btn auth-submit" type="submit">로그인</button></form><p class="note"></p>`;
  document.body.append(dialog);
  const form=dialog.querySelector('form'),errorBox=dialog.querySelector('.auth-error');
  let mode='login',busy=false,queue=Promise.resolve(),syncState='saved',syncError=null,expired=false,unsaved=false,checking=false;
  const link=/^#(verify|reset)=([a-f0-9]{64})$/.exec(location.hash);
  if(link)history.replaceState(null,'',location.pathname+location.search);
  const note=dialog.querySelector('.note');
  note.className='auth-links';
  note.innerHTML='<button class="auth-text-button" type="button" data-recovery="request">비밀번호를 잊었어요</button>';
  const resend=document.createElement('button');
  resend.type='button';resend.className='auth-text-button auth-resend';resend.dataset.recovery='resend';resend.hidden=true;
  resend.textContent='인증 메일 다시 받기';errorBox.after(resend);
  const signedIn=()=>{try{return sessionStorage.getItem('adsp-signed-in')==='1';}catch{return false;}};
  function markSession(active){try{if(active)sessionStorage.setItem('adsp-signed-in','1');else sessionStorage.removeItem('adsp-signed-in');}catch{}}
  async function api(url,method='GET',data){
    const response=await fetch(url,{method,credentials:'same-origin',headers:method==='GET'?{}:{'Content-Type':'application/json',...(url==='/api/progress'&&auth.user?{'X-Study-User':String(auth.user.id)}:{})},body:data===undefined?undefined:JSON.stringify(data)});
    const result=await response.json();
    if(!response.ok)throw Object.assign(Error(result.error||'요청을 처리할 수 없습니다.'),{status:response.status,code:result.code});
    return result;
  }
  function clearEphemeral(){clearActivity();}
  function loadGuest(){try{return sanitize(JSON.parse(localStorage.getItem(KEY)));}catch{return fresh();}}
  const auth=window.StudyAuth={
    user:null,
    ready:false,
    expire(){
      if(expired)return;expired=true;main.inert=true;
      if(auth.user)auth.user={...auth.user,role:'member'};
      updateAccount();auth.status();showSyncError();
      if(!dialog.open){switchMode('login');if(auth.user)form.elements.email.value=auth.user.email;errorBox.textContent='세션이 만료되었습니다. 다시 로그인해 주세요.';dialog.showModal();}
    },
    status(){const el=document.getElementById('save-status');el.textContent=expired?'세션 만료 · 다시 로그인':syncState==='saving'?'● 계정에 저장 중…':syncState==='error'?'저장 실패 · 아래에서 재시도':'● 계정에 저장됨';},
    save(value){
      const payload=JSON.stringify(value),userId=auth.user.id;
      if(expired){unsaved=true;return;}
      syncState='saving';syncError=null;auth.status();
      queue=queue.then(async()=>{
        if(auth.user?.id!==userId)return;
        if(expired){unsaved=true;return;}
        try{await api('/api/progress','PUT',JSON.parse(payload));syncState='saved';syncError=null;document.getElementById('sync-notice')?.remove();}
        catch(error){syncState='error';syncError=error;if(error.code==='SESSION_EXPIRED'){unsaved=true;auth.expire();}else showSyncError();}
        auth.status();
      });
    }
  };
  function showSyncError(){
    const existing=document.getElementById('sync-notice');if(existing&&!expired)return;existing?.remove();
    const el=document.createElement('div');el.id='sync-notice';el.className='notice';el.setAttribute('role','alert');
    el.innerHTML=expired?'세션이 만료되었습니다. 같은 계정으로 다시 로그인하면 저장하지 못한 기록을 이어서 저장합니다. <button class="btn secondary" type="button">다시 로그인</button>':'학습 기록을 서버에 저장하지 못했습니다. 이 탭을 닫기 전에 다시 저장해 주세요. <button class="btn secondary" type="button">다시 저장</button>';
    el.querySelector('button').onclick=()=>{if(expired){switchMode('login');if(auth.user)form.elements.email.value=auth.user.email;if(!dialog.open)dialog.showModal();}else auth.save(progressSnapshot());};header.after(el);
  }
  function updateAccount(){
    window.ContentAdmin?.update();
    accountButton.textContent=expired?'다시 로그인':auth.user?'로그아웃':'로그인 / 회원가입';
    const bottom=document.querySelector('.side-bottom');
    bottom.querySelector('div').textContent=auth.user?auth.user.email:'꾸준히 공부하는 나';
    const small=document.createElement('small');small.textContent=auth.user?'나의 학습 기록과 함께':'게스트 · 이 브라우저에서 공부하기';bottom.querySelector('div').append(small);
    bottom.querySelector('.avatar').textContent=auth.user?'✓':'나';
    document.querySelector('.workspace span').textContent=auth.user?'계정':'게스트';
  }
  function redraw(){render();if(auth.user){document.querySelectorAll('.note').forEach(n=>{if(n.textContent.includes('현재 기기와 브라우저'))n.textContent='ⓘ 로그인한 계정에 학습 기록이 저장됩니다. 같은 계정으로 다시 접속해 이어서 공부하세요.';});}}
  // Keep account-specific storage guidance current after navigation and learning actions.
  const observer=new MutationObserver(()=>{if(!auth.user)return;document.querySelectorAll('#main .note').forEach(n=>{if(n.textContent.includes('현재 기기와 브라우저'))n.textContent='ⓘ 로그인한 계정에 학습 기록이 저장됩니다. 같은 계정으로 다시 접속해 이어서 공부하세요.';});});
  observer.observe(main,{childList:true,subtree:true});
  function switchMode(next){
    mode=next;dialog.dataset.authMode=next;form.reset();errorBox.textContent='';resend.hidden=true;note.hidden=next!=='login';
    dialog.querySelector('.auth-tabs').hidden=['verify','reset'].includes(next);
    dialog.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
    const tokenMode=['verify','reset'].includes(mode),mailOnly=['request','resend'].includes(mode),confirmation=['register','reset'].includes(mode);
    const titles={login:'다시 만나 반가워요.',register:'나만의 학습을 시작하세요.',request:'비밀번호 재설정 링크 요청',resend:'이메일 인증 링크 다시 받기',verify:'가입 이메일 인증',reset:'새 비밀번호 설정'};
    dialog.querySelector('#auth-title').textContent=titles[mode];
    dialog.querySelector('.auth-description').textContent=mode==='verify'?'가입할 때 입력한 비밀번호를 확인해 주세요.':mode==='register'?'가입 후 이메일 인증을 완료해 주세요.':mode==='reset'?'새 비밀번호를 입력해 주세요.':mailOnly?'가입한 이메일 주소를 입력해 주세요.':'로그인하고 나의 학습을 이어가세요.';
    for(const [name,hidden] of [['email',tokenMode],['password',mailOnly],['confirm',!confirmation]]){const field=form.elements[name];field.closest('label').hidden=hidden;field.disabled=hidden;field.required=!hidden;}
    dialog.querySelector('.import-field').hidden=mode!=='register';
    form.elements.password.autocomplete=confirmation?'new-password':'current-password';
    form.querySelector('.auth-submit').textContent={login:'로그인',register:'가입 및 인증 링크 요청',request:'재설정 링크 요청',resend:'인증 링크 요청',verify:'이메일 인증 완료',reset:'비밀번호 재설정'}[mode];
  }
  note.querySelector('[data-recovery]').onclick=()=>{if(!busy){const email=form.elements.email.value;switchMode('request');form.elements.email.value=email;}};
  resend.onclick=async()=>{
    if(busy)return;
    const email=form.elements.email.value.trim();
    if(mode!=='login'||!email||!form.elements.email.validity.valid){switchMode('resend');form.elements.email.value=email;return;}
    busy=true;resend.disabled=true;
    try{await api('/api/email/resend','POST',{email});errorBox.textContent='인증 링크를 다시 요청했습니다. 이메일을 확인해 주세요.';}
    catch(error){errorBox.textContent=error.message;}
    finally{busy=false;resend.disabled=false;}
  };
  dialog.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{if(!busy)switchMode(b.dataset.mode);});
  dialog.querySelector('.auth-close').onclick=()=>{if(!busy)dialog.close();};
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  accountButton.onclick=async()=>{
    if(auth.user&&!expired){
      accountButton.disabled=true;main.inert=true;
      await queue;
      if(syncError){accountButton.disabled=false;main.inert=false;showSyncError();return;}
      try{await api('/api/logout','POST',{});markSession(false);auth.user=null;state=loadGuest();clearEphemeral();document.getElementById('sync-notice')?.remove();updateAccount();redraw();}
      catch(error){if(error.code==='SESSION_EXPIRED')auth.expire();else document.getElementById('save-status').textContent='로그아웃 실패 · 다시 시도해 주세요.';}
      finally{accountButton.disabled=false;main.inert=expired;}
      return;
    }
    switchMode('login');if(expired&&auth.user)form.elements.email.value=auth.user.email;dialog.showModal();
    if(location.protocol==='file:') {errorBox.textContent='로그인은 서버 실행이 필요합니다. 프로젝트 폴더에서 npm start 실행 후 http://127.0.0.1:4173 으로 접속해 주세요.';dialog.querySelector('.auth-submit').disabled=true;}
  };
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;
    if(['register','reset'].includes(mode)&&form.elements.password.value!==form.elements.confirm.value){errorBox.textContent='비밀번호 확인이 일치하지 않습니다.';return;}
    busy=true;errorBox.textContent='';resend.hidden=true;form.querySelector('button[type=submit]').disabled=true;
    const email=form.elements.email.value.trim().toLowerCase(),password=form.elements.password.value,guest=loadGuest();
    const prior=auth.user,restore=expired&&unsaved;
    let account;
    try{
      if(mode!=='login'){
        const action=mode,endpoint={register:'/api/register',resend:'/api/email/resend',request:'/api/password/request',verify:'/api/email/verify',reset:'/api/password/reset'}[action];
        const result=await api(endpoint,'POST',['verify','reset'].includes(action)?{token:link?.[2],password}:['request','resend'].includes(action)?{email}:{email,password});
        if(action==='register'&&form.elements.import.checked){try{localStorage.setItem('adsp-guest-import-email',email);}catch{}}
        if(action==='reset'&&auth.user)await checkSession();
        switchMode('login');form.elements.email.value=email;
        errorBox.textContent=action==='verify'?'이메일 인증을 완료했습니다. 로그인해 주세요.':action==='reset'?'비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요.':action==='register'&&result.delivery===false?'계정은 생성되었지만 인증 링크를 보내지 못했습니다. 다시 요청해 주세요.':action==='request'?'재설정 링크를 요청했습니다. 이메일을 확인해 주세요.':'인증 링크를 요청했습니다. 이메일을 확인해 주세요.';
        resend.hidden=!['register','resend'].includes(action);
        return;
      }
      if(restore&&prior?.email!==email){errorBox.textContent='저장하지 못한 기록을 복구하려면 이전과 같은 계정으로 로그인해 주세요.';return;}
      const result=await api('/api/login','POST',{email,password});account=result.user;
      const saved=await api('/api/progress');
      const recover=restore&&prior?.id===account.id;
      expired=false;unsaved=false;syncError=null;syncState='saved';markSession(true);
      auth.user=account;if(!recover)state=sanitize(saved.progress);clearEphemeral();main.inert=false;document.getElementById('sync-notice')?.remove();updateAccount();redraw();
      let importGuest=false;try{if(localStorage.getItem('adsp-guest-import-email')===account.email){importGuest=true;localStorage.removeItem('adsp-guest-import-email');}}catch{}
      if(recover||importGuest&&!saved.progress){if(!recover)state=sanitize(guest);auth.save(progressSnapshot());redraw();}
      form.reset();dialog.close();
    }catch(error){
      if(account){errorBox.textContent='학습 기록을 불러오지 못했습니다. 다시 로그인해 주세요.';}
      else{
        errorBox.textContent=error.message||'서버에 연결할 수 없습니다. npm start로 실행했는지 확인해 주세요.';
        resend.hidden=error.code!=='EMAIL_UNVERIFIED'&&!(mode==='verify'&&error.status===400);
      }
    }finally{busy=false;form.querySelector('button[type=submit]').disabled=false;}
  });
  window.addEventListener('beforeunload',e=>{if(auth.user&&(syncState==='saving'||syncError||unsaved)){e.preventDefault();e.returnValue='';}});
  async function checkSession(){
    if(!auth.ready||!auth.user||expired||checking)return;
    checking=true;const id=auth.user.id;
    try{const result=await api('/api/me');if(auth.user?.id===id&&result.user?.id!==id){if(syncState==='saving'||syncError)unsaved=true;auth.expire();}}catch{}finally{checking=false;}
  }
  setInterval(checkSession,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkSession();});
  async function init(){
    if(!await window.contentReady)return;
    updateAccount();if(location.protocol==='file:')return;
    main.inert=true;accountButton.disabled=true;
    try{const result=await api('/api/me');if(result.user){const saved=await api('/api/progress');auth.user=result.user;markSession(true);state=sanitize(saved.progress);clearEphemeral();}auth.ready=true;updateAccount();redraw();main.inert=false;
      if(!result.user&&(result.expired||signedIn()))auth.expire();
      if(link){switchMode(link[1]);if(!dialog.open)dialog.showModal();}}
    catch(error){const notice=document.createElement('div');notice.className='notice';notice.textContent='로그인 상태를 확인하지 못했습니다. 서버 실행 상태를 확인한 뒤 새로고침해 주세요.';header.after(notice);}
    finally{accountButton.disabled=main.inert;}
  }
  init();
})();
