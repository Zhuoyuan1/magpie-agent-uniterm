// Magpie agent plugin — uniTerm
//
// uniTerm 把「AI 模型列表」存在 %APPDATA%\uniTerm\ai.json（macOS:
// ~/Library/Application Support/uniTerm/ai.json，Linux: ~/.config/uniTerm/ai.json），
// 形如：
//
//   {
//     "maxTurns": 0,
//     "models": [
//       { "id": "model-1788915591254", "name": "gpt-6-astra",
//         "apiKey": "enc:v1:...", "baseURL": "https://fnuu.net/v1",
//         "model": "gpt-6-astra", "protocol": "responses",
//         "userAgent": "uniTerm" }
//     ]
//   }
//
// 当前选中哪一条不在这里，而在同目录 local_state.json 的 ai.activeModelId。
// 插件只能写一个文件，写不到 local_state.json，所以这里的做法是：
// 把整个 models 数组换掉。uniTerm 找不到原来的 activeModelId 时会退回第一条：
//
//   // frontend/src/stores/settingsStore.ts:40
//   models.find(m => m.id === activeModelId) || models[0]
//
// ─── 两种模式 ──────────────────────────────────────────────────────────
// A（默认，LIST_ALL_MODELS = false）：只写 1 条指向网关的记录。
//   uniTerm 里只显示这一个模型，换模型在 magpie 里点。magpie 侧显示一个
//   「model」下拉框。
// B（LIST_ALL_MODELS = true）：把 magpie 的全部模型都写进 uniTerm。
//   uniTerm 里直接列出 N 个模型，在 uniTerm 里选；magpie 侧只剩一个
//   provider 开关（开=接管，关=还原）。
//
// 为什么整组替换 models 而不是逐条改字段：
//   1) apiKey 是加密存的（enc:v1:）。magpie 只能写明文，uniTerm 下次启动
//      会把它重新加密 —— 字段值变了。magpie 判断「这条接线还是不是我的」
//      靠的是「自己写进去的那个字符串还在不在」，值一变它就认为用户改过，
//      之后切换/断开就不再还原，原始 key 会被永久覆盖。
//      整组替换时 magpie 的「锚点」是一个数组（不是字符串），它不做这项
//      校验，所以重新加密不影响还原 —— 断开时原数组（含加密 key）原样写回。
//   2) 逐条改字段得赌「哪条是激活的」，而激活信息在另一个文件里，猜不到。

// ─── 开关 ──────────────────────────────────────────────────────────────
// false = 模式 A（1 条，模型在 magpie 里选）
// true  = 模式 B（全量模型写进 uniTerm，在 uniTerm 里选）
const LIST_ALL_MODELS = true;

// "win" | "mac" | "linux"
const PLATFORM = "win";

const CONFIG = {
  win: "$APPDATA/uniTerm/ai.json",
  mac: "~/Library/Application Support/uniTerm/ai.json",
  linux: "~/.config/uniTerm/ai.json",
};

export const agent = {
  id: "uniterm",
  name: "uniTerm",

  // magpie 只会编辑这一个文件；$VAR 会按当前用户的真实环境变量展开
  config: CONFIG[PLATFORM] || CONFIG.win,
  format: "json",

  // 模式 A：magpie 在这个路径读写「当前模型」（models 是数组，用下标路径）
  // 模式 B：留空 —— magpie 就不写单个模型，而是把 connect 返回的整组模型
  //         交给 uniTerm 自己挑，magpie 侧只留一个 provider 开关
  model: LIST_ALL_MODELS ? "" : "models.0.model",

  // 用量统计里认领 uniTerm 发出的请求（uniTerm 自己的 User-Agent 就是 uniTerm）
  ua: ["uniterm"],

  // uniTerm 的后端在启动时把 ai.json 读进内存，改完要重启才生效
  notice: "uniTerm 启动时读取 ai.json：改完模型请重启 uniTerm。",
};

// 一条 uniTerm 模型记录：baseURL 指到网关，protocol openai 时 uniTerm 请求
// {baseURL}/chat/completions 并带 Authorization: Bearer <apiKey>
function entry(gateway, model) {
  const id = model.id || "";
  return {
    id: entryID(id),
    name: "Magpie · " + (model.name || id || "gateway"),
    apiKey: gateway.key,
    baseURL: gateway.v1 || gateway.url,
    model: id,
    protocol: "openai",
    userAgent: "uniTerm",
  };
}

// 用模型 id 派生稳定的记录 id：magpie 重新接线时 uniTerm 的 activeModelId
// 仍指向同一个模型，不会因为列表顺序变动而跳
function entryID(ref) {
  const slug = String(ref).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return "model-magpie-" + (slug || "gateway");
}

// magpie 写入时调用：返回「键路径 → 值」，它会逐键原地写进 ai.json，
// 注释、顺序、其它键都不动；并且写之前会把原值存起来，断开时还原。
export function connect(input) {
  const gateway = (input && input.gateway) || {};

  if (LIST_ALL_MODELS) {
    // 模式 B：input.models 是 magpie 的全部模型（含路由组），
    // 一次写进 uniTerm 的模型列表
    const all = (input && input.models) || [];
    return { models: all.filter((m) => m && m.id).map((m) => entry(gateway, m)) };
  }

  // 模式 A：只写当前这一个
  return { models: [entry(gateway, (input && input.model) || {})] };
}
