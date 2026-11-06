'use strict';

async function request(url,options){
  const response=await fetch(url,options);
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.error),{status:response.status});
  return result;
}

request('/api/public-service').then(({supportEmail})=>{
  if(!supportEmail)return;
  const link=document.querySelector('[data-email]');
  link.textContent=supportEmail;
  link.href='mailto:'+supportEmail;
  link.closest('[data-support]').hidden=false;
}).catch(()=>{});

const form=document.getElementById('delete-form');
if(form){
  const status=document.getElementById('delete-status');
  const login=document.getElementById('delete-login');
  request('/api/me').then(({user})=>{
    if(!user){
      status.textContent='삭제할 계정으로 로그인해 주세요.';
      login.hidden=false;
      return;
    }
    status.textContent=user.email+' 계정을 삭제합니다.';
    form.hidden=false;
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const button=form.querySelector('button');
      if(button.disabled)return;
      button.disabled=true;
      status.textContent='계정을 삭제하는 중입니다.';
      try{
        await request('/api/account/delete',{
          method:'POST',
          headers:{'Content-Type':'application/json','X-Study-User':String(user.id)},
          body:JSON.stringify({password:form.elements.password.value,confirmed:form.elements.confirmed.checked})
        });
        try{
          sessionStorage.removeItem('adsp-signed-in');
          if(localStorage.getItem('adsp-guest-import-email')===user.email)localStorage.removeItem('adsp-guest-import-email');
        }catch{}
        form.reset();
        form.hidden=true;
        status.textContent='계정과 학습 기록을 삭제했습니다.';
      }catch(error){
        form.elements.password.value='';
        status.textContent=error.status?error.message:'요청 결과를 확인하지 못했습니다. 페이지를 다시 열어 상태를 확인해 주세요.';
        if(error.status===401){form.hidden=true;login.hidden=false;}
      }finally{button.disabled=false;}
    });
  }).catch(()=>{status.textContent='로그인 상태를 확인하지 못했습니다. 페이지를 새로고침해 주세요.';});
}
