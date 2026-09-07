export function planningIssue(error) {
  if(error.code && error.userMessage)return {code:error.code,field:error.field,message:error.userMessage};
  const message=error.message || '';
  if(error.name==='SyntaxError')return {code:'INVALID_JSON',field:'response',message:'模型返回的 JSON 不完整或格式错误。'};
  if(error.name==='TimeoutError' || error.name==='AbortError')return {code:'MODEL_TIMEOUT',field:'response',message:'规划模型响应超时。'};
  const field=message.match(/Invalid design field: (\w+)/)?.[1];
  if(field)return {code:'INVALID_FIELD',field,message:`模型返回的 ${field} 字段缺失、类型错误或过长。`};
  if(/Brand name|brand name/.test(message))return {code:'BRAND_MISMATCH',field:'brandName',message:'模型返回的品牌名与输入不一致，已拒绝该方向。'};
  if(/not specific enough/.test(message))return {code:'INCOMPLETE_CONSTRUCTION',field:'construction',message:'模型的构型说明或设计依据不完整。'};
  if(/subject recognition/.test(message))return {code:'MISSING_RECOGNITION',field:'recognitionCue',message:'模型没有提供完整的主体和可见识别特征。'};
  if(/Parrot construction/.test(message))return {code:'SUBJECT_ANATOMY',field:'construction',message:'鹦鹉构型没有明确描述弯曲的钩喙。'};
  if(/wordmark|Wordmark|initials|lettering|Symbol cannot/.test(message))return {code:'LETTERING_MISMATCH',field:'lettering',message:'模型的字标、首字母或文字内容不符合要求。'};
  if(/repeat/.test(message))return {code:'DUPLICATE_DIRECTION',field:'construction',message:'这个方向与已有方向的构型重复。'};
  if(/construction type/.test(message))return {code:'INVALID_TYPE',field:'markType/geometry',message:'模型使用了不支持的标志类型或几何分类。'};
  if(/Contradictory/.test(message))return {code:'CONTRADICTORY_GEOMETRY',field:'construction',message:'模型的几何描述相互矛盾。'};
  return {code:'MODEL_ERROR',field:'response',message:'规划模型调用失败，请查看对应请求日志。'};
}
