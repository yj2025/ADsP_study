const {isDeepStrictEqual: equal}=require('node:util');

const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const setFields=new Set(['completed','completedIds','wrong','resolved']);
const navigation=new Set(['lesson','lessonId','quizIndex','questionId','selectedSubjectId','selectedUnitId']);

function conflict(){
  return Object.assign(Error('다른 기기에서 같은 학습 기록을 변경했습니다. 이 탭의 변경은 저장되지 않았습니다.'),{status:409,code:'PROGRESS_CONFLICT'});
}

function mergeProgress(base,next,current){
  function merge(before,after,stored,field,depth,parent){
    if(equal(before,after))return stored;
    if(equal(before,stored)||equal(after,stored))return after;
    if((depth===1&&navigation.has(field))||(depth===3&&parent==='positions')||field==='index')return after;
    if(depth===1&&setFields.has(field)&&Array.isArray(after)&&Array.isArray(stored)){
      const prior=Array.isArray(before)?before:[];
      const removed=new Set(prior.filter(value=>!after.includes(value)));
      return [...new Set([...stored.filter(value=>!removed.has(value)),...after.filter(value=>!prior.includes(value))])];
    }
    if(isObject(after)&&isObject(stored)&&(isObject(before)||before==null)){
      if((field==='exam'||parent==='quizRounds')&&
         (!equal(after.ids,stored.ids)||!equal(after.deadline,stored.deadline)))throw conflict();
      const result={...stored};
      for(const key of Object.keys({...before,...after})){
        const value=merge(Object.hasOwn(before??{},key)?before[key]:undefined,Object.hasOwn(after,key)?after[key]:undefined,Object.hasOwn(stored,key)?stored[key]:undefined,key,depth+1,field);
        if(value===undefined)delete result[key];
        else Object.defineProperty(result,key,{value,enumerable:true,writable:true,configurable:true});
      }
      return result;
    }
    throw conflict();
  }
  return merge(base,next,current,'',0);
}

module.exports={mergeProgress};
