export const DEFAULT_LOCAL_MODEL = 'qwen3.8:latest';

export function thinkingOptions(model) {
  return /(?:^|\/)qwen3\.(?:8|5(?:-[\w.-]+)?)(?::|$)/.test(model) ? {think:false} : {};
}

export async function localModel(url, names, capability) {
  const response=await fetch(`${url}/api/tags`,{signal:AbortSignal.timeout(5000)});
  if(!response.ok) throw new Error('无法读取本地模型列表。');
  const tags=await response.json();
  for(const name of names){
    const model=tags.models?.find(m=>m.name===name);
    if(!model || model.remote_host || model.remote_model || name.endsWith(':cloud'))continue;
    let capabilities=model.capabilities;
    if(!capabilities){
      const res=await fetch(`${url}/api/show`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:name}),signal:AbortSignal.timeout(10000)});
      if(!res.ok)continue;
      const details=await res.json();if(details.remote_host || details.remote_model)continue;
      capabilities=details.capabilities;
    }
    if(capabilities?.includes(capability))return name;
  }
  return null;
}
