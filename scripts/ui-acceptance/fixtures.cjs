'use strict';
const AT = '2026-11-14T08:00:00.000Z';
const LONG = 'GPT UI 旗舰视觉与长上下文模型——用于验证跨连接同名模型与超长中文名称边界';
const preferredModel = { modelId: 'gpt-ui', connectionId: 11, rawId: 'gpt-ui' };
const model = (connectionId, rawId, name, source, caps = {}) => ({
  id: rawId, rawId, name, provider: 'openai', channelName: source, displayName: source,
  connectionBaseUrl: 'https://fixture.invalid/v1', connectionId, capabilities: caps,
  contextWindow: 131072, maxOutputTokens: 16384, tags: [],
});
const models = [model(11, 'gpt-ui', LONG, 'Fixture 主连接', { vision: true }),
  model(12, 'gpt-ui', LONG, 'Fixture 备用连接', { vision: true }),
  model(11, 'gpt-image-ui', 'GPT Image Fixture 绘图', 'Fixture 主连接', { image_generation: true, vision: true }),
  model(13, 'claude-ui', 'Claude Fixture 中文推理', 'Fixture 推理连接'),
  { ...model(14, 'gemini-ui', 'Gemini Fixture 百万上下文', 'Fixture 长上下文连接', { vision: true }), contextWindow: 1048576 }];
const user = (role = 'ADMIN') => ({ id: role === 'ADMIN' ? 9001 : 9002, username: role === 'ADMIN' ? 'Fixture 管理员' : 'Fixture 普通用户',
  role, status: 'ACTIVE', createdAt: AT, avatarUrl: null, personalPrompt: 'Fixture：请用清晰中文回答，保留代码格式。', contextEnabled: true });
const actor = (kind) => kind === 'anonymous' ? {actor: {type:'anonymous',key:'ui-fixture',identifier:'ui-fixture',expiresAt:null},quota:null,preferredModel} :
  {actor:{type:'user',...user(kind === 'admin' ? 'ADMIN' : 'USER'),identifier:'ui-fixture',preferredModel},user:user(kind === 'admin' ? 'ADMIN' : 'USER'),quota:null,preferredModel};
const session = { id:9101,userId:9001,title:'Fixture · 中文代码与工具状态验收会话',createdAt:AT,connectionId:11,
  modelRawId:'gpt-ui',modelLabel:LONG,reasoningEnabled:true,reasoningEffort:'medium',knowledgeBaseIds:[],_count:{messages:4} };
const messages = [
  {id:91011,sessionId:9101,role:'user',content:'请整理本周 UI 发布要点，并给出一个 TypeScript 示例。中文长内容需要自然换行。',createdAt:AT},
  {id:91012,sessionId:9101,role:'assistant',content:'## 本周发布重点\n\n- 输入区：长模型名不挤压发送按钮。\n- 选择器：按模型家族分组，并区分跨连接同名模型。\n- 移动端：抽屉关闭与键盘焦点可达。\n\n```typescript\nconst release = { name: "青瓷与雾", ready: true };\nconsole.log(release.name);\n```\n\n| 项目 | 结果 |\n| --- | --- |\n| 窄屏排版 | 等待浏览器验收 |\n| 跨连接身份 | 保留复合键 |',reasoning:'先比较信息层级，再检查键盘与布局边界。',reasoningStatus:'done',reasoningDurationSeconds:3,streamStatus:'done',createdAt:AT,
    toolEvents:[{id:'fixture-tool-1',sessionId:9101,messageId:91012,tool:'web_search',stage:'result',status:'success',summary:'Fixture：检索到3条发布资料',createdAt:Date.parse(AT),callId:'call-fixture-1',identifier:'web_search',apiName:'web_search',details:{query:'本周发布要点',resultText:'Fixture：检索完成'}}]},
  {id:91013,sessionId:9101,role:'user',content:'接着检查：长链接 https://fixture.invalid/docs/very-long-navigation-boundary-and-layout-with-Chinese-中文说明，以及错误状态。',createdAt:AT},
  {id:91014,sessionId:9101,role:'assistant',content:'这是明确标注的 **Fixture 消息**。仅检验 UI，未发送模型请求。\n\n> 工具失败后仍应保留上一条可读结果。',streamStatus:'done',createdAt:AT,
    toolEvents:[{id:'fixture-tool-2',sessionId:9101,messageId:91014,tool:'read_url',stage:'error',status:'error',summary:'Fixture：上游暂时不可用',createdAt:Date.parse(AT),callId:'call-fixture-2',identifier:'read_url',apiName:'read_url',details:{error:'Fixture：上游暂时不可用'}}]},
];
const settings = {allow_registration:true,registration_require_approval:false,brand_text:'AIChat · Fixture',
  anonymous_daily_quota:20,default_user_daily_quota:100,site_base_url:'http://localhost:3000',
  battle_allow_anonymous:true,battle_allow_users:true,battle_anonymous_daily_quota:5,battle_user_daily_quota:20,battle_retention_days:30,
  model_access_default_anonymous:'allow',model_access_default_user:'allow',web_search_agent_enable:true,
  web_search_enabled_engines:['bing','tavily'],web_search_engine_order:['bing','tavily'],web_search_result_limit:5,
  python_tool_enable:true,chat_dynamic_skill_runtime_enabled:true,context_compression_enabled:true,context_compression_threshold_ratio:0.8,
  context_compression_tail_messages:6,reasoning_enabled:true,reasoning_save_to_db:true,sse_heartbeat_interval_ms:15000,
  provider_timeout_ms:120000,provider_max_idle_ms:60000,temperature_default:0.7,web_search_scope:'webpage',
  assistant_avatar_url:null,setup_state:'completed',system_prompt_max_length:12000};
const logs = [{id:1,ts:AT,level:'info',tag:'fixture.chat.streaming.long-tag-中文流式消息验收与上下文数据检查',
  msg:'Fixture：中文消息渲染完成。长 URL：https://fixture.invalid/docs/streaming/very-long-path-for-ui-overflow-validation?source=fixture&language=zh-CN',
  ctx:{fixture:true,model:{connectionId:11,rawId:'gpt-ui'},request:{url:'https://fixture.invalid/v1/chat/completions',durationMs:1280},中文说明:'折叠上下文应能展开、横向内容应留在容器内'}},
  {id:2,ts:AT,level:'warn',tag:'fixture.runtime',msg:'Fixture：一次可恢复的超时，保留已有日志。',ctx:{attempt:1,retryable:true}},
  {id:3,ts:AT,level:'error',tag:'fixture.provider',msg:'Fixture：演示失败状态；没有真实供应商请求。',ctx:{status:503}}];
const share = {id:9101,sessionId:9101,token:'ui-fixture-public',title:'Fixture · 公开分享中文会话',sessionTitle:session.title,messageCount:messages.length,
  messages,isLive:false,streamingMessageIds:[],createdAt:AT,expiresAt:null,revokedAt:null};
module.exports = {AT,LONG,models,user,actor,preferredModel,session,messages,settings,logs,share};
