import { messages } from "../data/messages";
import type { ApiFailure, Locale } from "../types";
export type Params = Record<string, string | number>;
export function translate(locale: Locale, key: string, params: Params = {}) {
  const canonical = messages[key]
    ? key
    : Object.keys(messages).find((k) => messages[k][0] === key);
  const template =
    (canonical ? messages[canonical]?.[locale === "en" ? 0 : 1] : undefined) ??
    key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params[name] ?? `{${name}}`),
  );
}
export function errorMessage(data: ApiFailure, locale: Locale) {
  const t = (key: string) => translate(locale, key);
  const map: Record<string, [string, string]> = {
    AUTH_REQUIRED: ["Please sign in to generate logos.", "请登录后生成 Logo。"],
    CREDITS_REQUIRED: [
      "You need more credits. Choose a pack in Pricing.",
      "可用额度不足，请前往套餐页购买。",
    ],
    GENERATION_BUSY: [
      "A logo is already generating. Please wait.",
      "已有一张 Logo 正在生成，请稍候。",
    ],
    CLOUD_CONFIG_REQUIRED: [
      "The service is being configured. Please try again later.",
      "服务正在配置中，请稍后再试。",
    ],
    CLOUD_IMAGE_UNAVAILABLE: [
      "Cloud generation is not available yet.",
      "云端生成服务尚未开放。",
    ],
    STORAGE_UNAVAILABLE: [
      "Image storage is temporarily unavailable.",
      "图片存储暂时不可用。",
    ],
    GENERATION_PENDING: [
      "Your logo is still processing. Open History to check its progress.",
      "Logo 仍在处理中，可到生成历史查看进度。",
    ],
    GENERATION_SUBMIT_FAILED: [
      "Submission failed. Your credit was returned.",
      "提交失败，额度已返还。",
    ],
    IMAGE_PROVIDER_BILLING_REQUIRED: [
      "The image provider requires a top-up by the site administrator. Your Logo2logo credit was returned; buying site credits will not resolve this issue.",
      "出图服务商 fal 要求站点管理员充值后才能生成。你的 Logo2logo 额度已返还，购买站内额度无法解决此问题。",
    ],
    IMAGE_PROVIDER_ACCESS_DENIED: [
      "The image provider denied access. The site administrator needs to check its configuration. Your credit was returned.",
      "出图服务商拒绝访问，需要站点管理员检查配置。你的额度已返还。",
    ],
    IMAGE_PROVIDER_BUSY: [
      "The image provider is busy. Please try again later. Your credit was returned.",
      "出图服务商暂时繁忙，请稍后再试。你的额度已返还。",
    ],
    GENERATION_FAILED: [
      "Generation failed. Your credit was returned.",
      "生成失败，额度已返还。",
    ],
    GENERATION_INTERRUPTED: [
      "The task was interrupted. Your credit was returned.",
      "任务中断，额度已返还。",
    ],
    GENERATION_EXPIRED: [
      "The image service no longer has this result. Your credit was returned.",
      "图像服务中的结果已过期，额度已返还。",
    ],
    GENERATION_NO_IMAGE: [
      "No usable image was returned. Your credit was returned.",
      "未返回可用图片，额度已返还。",
    ],
    SERVICE_UNAVAILABLE: [
      "The service is temporarily unavailable. Please try again.",
      "服务暂时不可用，请重试。",
    ],
    SOURCE_NOT_APPROVED: [
      "Choose a draft that passed its visual check before refining.",
      "请选择已通过视觉初筛的草稿进行微调。",
    ],
    PLAN_RATE_LIMIT: [
      "Too many design requests. Please try again in an hour.",
      "设计请求过于频繁，请一小时后再试。",
    ],
    OUTPUT_NOT_FOUND: [
      "This logo is not available in your account.",
      "你的账户中没有这张 Logo。",
    ],
    REFERENCE_REQUIRED: [
      "Choose a reference logo first.",
      "请先选择参考 Logo。",
    ],
    INVALID_REFERENCE: [
      "This reference is no longer available. Choose another.",
      "参考 Logo 无效，请重新选择。",
    ],
    INVALID_BRIEF: ["Please describe your brand.", "请填写品牌简报。"],
    BRIEF_TOO_LONG: [
      "Keep your brief within 1,500 characters.",
      "品牌简报请控制在 1500 字以内。",
    ],
    BRIEF_CHANGED: [
      "Your brief or reference changed. Start a new design.",
      "简报或参考已改变，请开始新的设计。",
    ],
    PLAN_EXPIRED: [
      "This session expired. Start a new design.",
      "设计会话已过期，请重新开始。",
    ],
    PLAN_BUSY: [
      "This design is already being planned.",
      "这个设计正在规划中。",
    ],
    PLANNER_CHANGED: [
      "The model changed. Start a new design.",
      "模型已改变，请重新开始设计。",
    ],
    PLANNER_UNAVAILABLE: [
      "The planning model is unavailable.",
      "规划模型不可用。",
    ],
    MODEL_TIMEOUT: [
      "The model timed out. Please retry.",
      "模型响应超时，请重试。",
    ],
    MODEL_HTTP_ERROR: [
      "The model service returned an error. Please retry.",
      "模型服务返回错误，请重试。",
    ],
    MODEL_ERROR: [
      "The model could not complete this direction.",
      "模型未能完成此方向。",
    ],
    TRUNCATED_OUTPUT: [
      "The response was cut short. Retry this direction.",
      "模型输出被截断，请重试此方向。",
    ],
    INVALID_FIELD: [
      "The design response contains an invalid field.",
      "设计响应包含无效字段。",
    ],
    EDITOR_UNAVAILABLE: [
      "The image engine is not ready. Please try again later.",
      "图像引擎尚未就绪，请稍后重试。",
    ],
    SERVER_DRAINING: [
      "The service is restarting. Please try again shortly.",
      "服务正在重启，请稍后重试。",
    ],
    CROSS_ORIGIN: ["This request is not allowed.", "不允许此请求。"],
    PAYLOAD_TOO_LARGE: ["The request is too large.", "请求内容过大。"],
    INVALID_JSON_BODY: ["The request format is invalid.", "请求格式无效。"],
  };
  if (data.code && map[data.code])
    return map[data.code][locale === "en" ? 0 : 1];
  const diagnostics: Record<string, [string, string]> = {
    INVALID_JSON: [
      "The model returned invalid JSON. Retry this direction.",
      "模型返回了无效 JSON，请重试此方向。",
    ],
    BRAND_MISMATCH: [
      "The returned brand name did not match your brief.",
      "返回的品牌名与简报不一致。",
    ],
    INCOMPLETE_CONSTRUCTION: [
      "The design description is incomplete.",
      "构型说明不完整。",
    ],
    MISSING_RECOGNITION: [
      "The direction lacks recognizable subject features.",
      "方向缺少可辨识的主体特征。",
    ],
    SUBJECT_ANATOMY: [
      "The subject anatomy does not match the brief.",
      "主体结构不符合要求。",
    ],
    LETTERING_MISMATCH: [
      "The lettering does not match your requirements.",
      "文字内容不符合要求。",
    ],
    DUPLICATE_DIRECTION: [
      "This direction repeats an existing design.",
      "此方向与已有设计重复。",
    ],
    INVALID_TYPE: [
      "The model returned an unsupported design type.",
      "模型返回了不支持的设计类型。",
    ],
    CONTRADICTORY_GEOMETRY: [
      "The geometry description is contradictory.",
      "几何描述相互矛盾。",
    ],
  };
  if (data.code && diagnostics[data.code])
    return diagnostics[data.code][locale === "en" ? 0 : 1];
  const raw = data.error || data.message || "";
  if (messages[raw]) return t(raw);
  return locale === "en" && /\p{Script=Han}/u.test(raw)
    ? t("genericError")
    : raw || t("genericError");
}
