import {randomUUID,createHash} from 'node:crypto';

// Server-owned checkpoints: the browser cannot submit invented accepted designs.
export function createPlanningSessions({maxSessions=50,ttlMs=30*60*1000,now=Date.now}={}) {
  const sessions=new Map();
  return async function withSession(input,work) {
    if(!input || typeof input.description!=='string' || !input.description.trim())throw Object.assign(new Error('请用一句话介绍品牌。'),{status:400,code:'INVALID_BRIEF'});
    if(input.description.length>1500)throw Object.assign(new Error('品牌描述请控制在 1500 字以内。'),{status:400,code:'BRIEF_TOO_LONG'});
    for(const [id,item] of sessions)if(!item.busy && now()-item.touched>ttlMs)sessions.delete(id);
    const fingerprint=createHash('sha256').update(JSON.stringify([input.description,input.style || null,input.referenceId || null,input.referenceFile || null])).digest('hex');
    let session=input.resumeId?sessions.get(input.resumeId):null;
    if(input.resumeId && !session)throw Object.assign(new Error('续跑记录已过期或服务已重启，请重新提交品牌描述。'),{status:410,code:'PLAN_EXPIRED'});
    if(session && session.fingerprint!==fingerprint)throw Object.assign(new Error('品牌描述或参考图已改变，请开始新的设计。'),{status:409,code:'BRIEF_CHANGED'});
    if(session?.busy)throw Object.assign(new Error('该设计正在规划中，请勿重复提交。'),{status:409,code:'PLAN_BUSY'});
    if(!session){
      if(sessions.size>=maxSessions){const idle=[...sessions.values()].find(item=>!item.busy);if(idle)sessions.delete(idle.id);else throw Object.assign(new Error('规划任务较多，请稍后再试。'),{status:429});}
      session={id:randomUUID(),fingerprint,checkpoint:{concepts:[],territories:[]},touched:now()};sessions.set(session.id,session);
    }
    session.busy=true;session.touched=now();
    try{return {...await work(session),resumeId:session.id};}
    finally{session.busy=false;session.touched=now();}
  };
}
