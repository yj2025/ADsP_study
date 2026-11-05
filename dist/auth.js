'use strict';
(() => {
  const header=document.querySelector('header');
  const accountButton=document.createElement('button');
  accountButton.className='account-button';
  accountButton.textContent='로그인 / 회원가입';
  header.append(accountButton);
  const dialog=document.createElement('dialog');
  dialog.className='auth-dialog';
  dialog.setAttribute('aria-labelledby','auth-title');
  dialog.innerHTML=`<button class="auth-close" aria-label="닫기" type="button">×</button><span class="eyebrow">MY STUDY ACCOUNT</span><h2 id="auth-title">다시 만나 반가워요.</h2><p class="muted auth-description">로그인하고 나의 학습을 이어가세요.</p><div class="auth-tabs" role="group" aria-label="계정 메뉴"><button type="button" data-mode="login" class="active">로그인</button><button type="button" data-mode="register">회원가입</button></div><form><label>이메일<input name="email" type="email" autocomplete="username" placeholder="you@example.com" maxlength="254" required></label><label>비밀번호<input name="password" type="password" autocomplete="current-password" placeholder="10자 이상, 128자 이하" minlength="10" maxlength="128" required></label><label class="confirm-field" hidden>비밀번호 확인<input name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="128"></label><label class="import-field" hidden><input name="import" type="checkbox"> 이 브라우저의 게스트 학습 기록을 가져오기</label><p class="auth-error" role="alert"></p><button class="btn auth-submit" type="submit">로그인</button></form><p class="note">회원가입 시 이메일 인증은 진행하지 않습니다.<br>비밀번호를 재설정하는 기능은 아직 제공되지 않습니다.</p>`;
  document.body.append(dialog);
  const form=dialog.querySelector('form'),errorBox=dialog.querySelector('.auth-error');
  let mode='login',busy=false,queue=Promise.resolve(),syncState='saved',syncError=null;
  async function api(url,method='GET',data){
    const response=await fetch(url,{method,credentials:'same-origin',headers:method==='GET'?{}:{'Content-Type':'application/json',...(url==='/api/progress'&&auth.user?{'X-Study-User':String(auth.user.id)}:{})},body:data===undefined?undefined:JSON.stringify(data)});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'요청을 처리할 수 없습니다.');
    return result;
  }
  function clearEphemeral(){selected=null;reviewId=null;reviewResult=null;quizSummary=false;}
  function loadGuest(){try{return sanitize(JSON.parse(localStorage.getItem(KEY)));}catch{return fresh();}}
  const auth=window.StudyAuth={
    user:null,
    status(){const el=document.getElementById('save-status');el.textContent=syncState==='saving'?'● 계정에 저장 중…':syncState==='error'?'저장 실패 · 아래에서 재시도':'● 계정에 저장됨';},
    save(value){
      const payload=JSON.stringify(value),userId=auth.user.id;
      syncState='saving';syncError=null;auth.status();
      queue=queue.then(async()=>{
        if(auth.user?.id!==userId)return;
        try{await api('/api/progress','PUT',JSON.parse(payload));syncState='saved';syncError=null;document.getElementById('sync-notice')?.remove();}
        catch(error){syncState='error';syncError=error;showSyncError();}
        auth.status();
      });
    }
  };
  function showSyncError(){
    if(document.getElementById('sync-notice'))return;
    const el=document.createElement('div');el.id='sync-notice';el.className='notice';el.setAttribute('role','alert');
    el.innerHTML='학습 기록을 서버에 저장하지 못했습니다. 이 탭을 닫기 전에 다시 저장해 주세요. <button class="btn secondary" type="button">다시 저장</button>';
    el.querySelector('button').onclick=()=>auth.save(progressSnapshot());header.after(el);
  }
  function updateAccount(){
    accountButton.textContent=auth.user?'로그아웃':'로그인 / 회원가입';
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
  function switchMode(next){mode=next;form.reset();errorBox.textContent='';dialog.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});const register=mode==='register';dialog.querySelector('#auth-title').textContent=register?'나만의 학습을 시작하세요.':'다시 만나 반가워요.';dialog.querySelector('.auth-description').textContent=register?'계정을 만들고 학습 기록을 차곡차곡 쌓아보세요.':'로그인하고 나의 학습을 이어가세요.';dialog.querySelector('.confirm-field').hidden=!register;form.elements.confirm.required=register;dialog.querySelector('.import-field').hidden=!register;form.elements.password.autocomplete=register?'new-password':'current-password';dialog.querySelector('.auth-submit').textContent=register?'가입하고 시작하기':'로그인';}
  dialog.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{if(!busy)switchMode(b.dataset.mode);});
  dialog.querySelector('.auth-close').onclick=()=>{if(!busy)dialog.close();};
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  accountButton.onclick=async()=>{
    if(auth.user){
      accountButton.disabled=true;main.inert=true;
      await queue;
      if(syncError){accountButton.disabled=false;main.inert=false;showSyncError();return;}
      try{await api('/api/logout','POST',{});auth.user=null;state=loadGuest();clearEphemeral();document.getElementById('sync-notice')?.remove();updateAccount();redraw();}
      catch(error){document.getElementById('save-status').textContent='로그아웃 실패 · 다시 시도해 주세요.';}
      finally{accountButton.disabled=false;main.inert=false;}
      return;
    }
    switchMode('login');dialog.showModal();
    if(location.protocol==='file:') {errorBox.textContent='로그인은 서버 실행이 필요합니다. 프로젝트 폴더에서 npm start 실행 후 http://127.0.0.1:4173 으로 접속해 주세요.';dialog.querySelector('.auth-submit').disabled=true;}
  };
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;
    if(mode==='register'&&form.elements.password.value!==form.elements.confirm.value){errorBox.textContent='비밀번호 확인이 일치하지 않습니다.';return;}
    busy=true;errorBox.textContent='';form.querySelector('button[type=submit]').disabled=true;
    const importGuest=mode==='register'&&form.elements.import.checked,guest=state;
    let account;
    try{
      const result=await api(mode==='register'?'/api/register':'/api/login','POST',{email:form.elements.email.value,password:form.elements.password.value});account=result.user;
      const saved=await api('/api/progress');
      auth.user=account;state=sanitize(saved.progress);clearEphemeral();updateAccount();redraw();
      if(importGuest&&!saved.progress){state=sanitize(guest);auth.save(progressSnapshot());redraw();}
      form.reset();dialog.close();
    }catch(error){
      if(account){auth.user=account;state=fresh();clearEphemeral();updateAccount();main.inert=true;errorBox.textContent='로그인은 완료됐지만 학습 기록을 불러오지 못했습니다. 기록을 보호하기 위해 새로고침 후 다시 연결해 주세요.';}
      else errorBox.textContent=error.message||'서버에 연결할 수 없습니다. npm start로 실행했는지 확인해 주세요.';
    }finally{busy=false;form.querySelector('button[type=submit]').disabled=false;}
  });
  window.addEventListener('beforeunload',e=>{if(auth.user&&(syncState==='saving'||syncError)){e.preventDefault();e.returnValue='';}});
  async function init(){
    if(!await window.contentReady)return;
    updateAccount();if(location.protocol==='file:')return;
    main.inert=true;accountButton.disabled=true;
    try{const result=await api('/api/me');if(result.user){const saved=await api('/api/progress');auth.user=result.user;state=sanitize(saved.progress);clearEphemeral();}updateAccount();redraw();main.inert=false;}
    catch(error){const notice=document.createElement('div');notice.className='notice';notice.textContent='로그인 상태를 확인하지 못했습니다. 서버 실행 상태를 확인한 뒤 새로고침해 주세요.';header.after(notice);}
    finally{accountButton.disabled=main.inert;}
  }
  init();
})();
