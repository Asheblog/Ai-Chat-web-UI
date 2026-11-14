'use strict';
const f=require('./fixtures.cjs');
const {battle,trace,events}=require('./fixtures-detail.cjs');
const ok=data=>({success:true,data});
const pagination=(total,limit=20)=>({page:1,limit,total,totalPages:Math.ceil(total/limit)});
function makeResolver(options={}) {
 let actorKind=options.actor||'admin',logReads=0,catalogReads=0;
 let preferred={...f.preferredModel};
 const currentSession={...f.session};
 const settings={...f.settings};
 return function resolve(method,path,query,body={}) {
  const key=method+' '+path;
  switch(key) {
   case 'GET /auth/actor': return ok({...f.actor(actorKind),preferredModel:preferred});
   case 'GET /auth/me':return ok(f.user(actorKind==='user'?'USER':'ADMIN'));
   case 'POST /auth/login': actorKind='admin';return ok({token:'ui-fixture-not-a-real-token',user:f.user()});
   case 'POST /auth/register':return ok({requiresApproval:true,message:'Fixture 注册已提交审批'});
   case 'GET /catalog/models':
    catalogReads++;
    if(!options.modelsRecovered&&(options.variant==='models-error'||options.variant==='models-refresh-error'&&options.failModels))return {status:503,body:{success:false,error:'Fixture 模型目录暂不可用'}};
    return ok(options.variant==='models-empty'&&!options.modelsRecovered?[]:f.models);
   case 'POST /catalog/models/refresh':return ok({count:f.models.length});
   case 'GET /catalog/models/overrides':return ok([]);
   case 'GET /settings/branding':return ok({brand_text:'AIChat · Fixture'});
   case 'GET /settings/system':return ok(settings);
   case 'PUT /settings/system':Object.assign(settings,body);return ok({saved:true});
   case 'GET /settings/app-info':return ok({name:'AIChat · Fixture',version:'fixture',mode:'development',features:{battle:true,share:true},limits:{system_prompt_max_length:12000}});
   case 'GET /settings/setup-status':return ok({setup_state:'completed',hasAdmin:true,hasConnections:true,hasModels:true,completed:true});
   case 'PUT /settings/personal':
    if(body.preferred_model)preferred=body.preferred_model;
    return ok({...f.user(actorKind==='user'?'USER':'ADMIN'),preferredModel:preferred});
   case 'GET /sessions':return ok({sessions:[currentSession]});
   case 'GET /sessions/9101':return ok(currentSession);
   case 'GET /chat/sessions/usage':return ok([]);
   case 'GET /chat/sessions/9101/messages':return ok({messages:f.messages,pagination:pagination(f.messages.length)});
   case 'GET /chat/sessions/9101/artifacts':return ok({artifacts:[]});
   case 'PUT /sessions/9101/model':Object.assign(currentSession,{connectionId:body.connectionId,modelRawId:body.rawId});return ok(currentSession);
   case 'GET /connections':return ok([11,12].map(id=>({id,connectionIds:[id],name:id===11?'Fixture 主连接':'Fixture 备用连接',displayName:id===11?'Fixture 主连接':'Fixture 备用连接',provider:'openai',baseUrl:'https://fixture.invalid/v1',authType:'bearer',prefixId:'fixture-'+id,tags:[{name:'Fixture 中文长标签用于验证连接列表换行'}],connectionType:'openai',defaultCapabilities:{vision:true},apiKeys:[{id:id*10,apiKeyLabel:'Fixture测试标记',apiKeyMasked:'fixture-masked',hasStoredApiKey:false,modelIds:['gpt-ui','gpt-image-ui'],enable:true}],createdAt:f.AT,updatedAt:f.AT})));
   case 'GET /users':return ok({users:[f.user(),f.user('USER')],pagination:pagination(2)});
   case 'GET /shares':return ok({shares:[f.share],pagination:pagination(1)});
   case 'GET /shares/ui-v2-demo':return ok({...f.share,token:'ui-v2-demo'});
   case 'GET /shares/ui-v2-demo/messages':return ok({token:'ui-v2-demo',sessionId:9101,messages:f.messages,pagination:pagination(4,50)});
   case 'GET /prompt-templates':return ok({templates:[{id:1,title:'Fixture 发布说明',content:'请总结本周发布重点',variables:[],userId:9001,pinnedAt:null,createdAt:f.AT,updatedAt:f.AT}]});
   case 'GET /skills/catalog':case 'GET /skills/bindings':case 'GET /skills/approvals':return ok([]);
   case 'GET /skills/audits':return ok({items:[],total:0,hasMore:false,page:1,pageSize:20});
   case 'GET /skills/session-options':return ok({items:[]});
   case 'GET /skills/store':return ok({items:[],sources:[],refreshedAt:f.AT,anonymous:false});
   case 'GET /mcp/installations':case 'GET /mcp/connections':case 'GET /mcp/bindings':case 'GET /mcp/tools/search':case 'GET /mcp/sessions/9101/tools':return ok([]);
   case 'GET /secrets':return ok([]); // Only synthetic empty metadata; no secret contents read.
   case 'GET /knowledge-bases':case 'GET /knowledge-bases/admin':case 'GET /documents/admin/all':return ok([]);
   case 'GET /system-logs':
    logReads++;
    if(options.variant==='logs-first-error'||options.variant==='logs-refresh-error'&&options.failLogs)
     return {status:503,body:{success:false,error:'Fixture 系统日志暂不可用'}};
    return ok({items:f.logs,total:f.logs.length,hasMore:false});
   case 'GET /system-logs/tags':return ok({tags:f.logs.map(l=>l.tag)});
   case 'GET /system-logs/config':return ok({level:'info',toFile:true,logDir:'fixture/logs',retentionDays:7});
   case 'GET /system-logs/stats':return ok({totalFiles:1,totalSizeBytes:4096,oldestDate:'2026-11-14',newestDate:'2026-11-14',fileList:[{name:'fixture.log',sizeBytes:4096,date:'2026-11-14'}]});
   case 'GET /task-trace':return ok({items:[trace],total:1,page:1,pageSize:20});
   case 'GET /task-trace/9401':return ok({trace,latexTrace:null,events,truncated:false});
   case 'GET /battle/runs':return ok({runs:[battle],pagination:pagination(1)});
   case 'GET /battle/runs/9201':return ok(battle);
   case 'GET /settings/python-runtime':return ok({enabled:false,available:false,status:'unavailable',packages:[],installedPackages:[],indexes:[],message:'Fixture 运行时未连接'});
   default:return null;
  }
 };
}
async function installRoutes(context,options,report) {
 const resolve=makeResolver(options);
 let releaseModels;const modelGate=options.variant==='models-loading'?new Promise(resolve=>{releaseModels=resolve;}):null;
 const allowedOrigins=new Set([options.baseOrigin,'http://localhost:3000','http://127.0.0.1:3000','http://127.0.0.1:18001']);
 await context.route(url=>/^https?:$/.test(url.protocol),async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/api'||url.pathname.startsWith('/api/')) {
   if(!allowedOrigins.has(url.origin)) {
    report.gaps.push({type:'blocked-external-api',method:req.method(),url:url.origin+url.pathname});
    return route.abort('blockedbyclient');
   }
   const path=url.pathname.slice(4),method=req.method();
   if(method==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':options.baseOrigin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS'}});
   if(path==='/catalog/models'&&method==='GET'&&modelGate)await modelGate;
   let body;try{body=req.postDataJSON()||{};}catch{body={};}
   const response=resolve(method,path,url.searchParams,body);
   report.api.push({method,path,fixture:!!response});
   if(!response){report.gaps.push({type:'unhandled-api',method,path});
    return route.fulfill({status:501,contentType:'application/json',body:JSON.stringify({success:false,error:'UI_FIXTURE_UNHANDLED_API: '+method+' '+path})});}
   return route.fulfill({status:response.status||200,contentType:'application/json',headers:{'X-UI-Acceptance-Fixture':'true','Access-Control-Allow-Origin':options.baseOrigin,'Access-Control-Allow-Credentials':'true'},body:JSON.stringify(response.body||response)});
  }
  if(!allowedOrigins.has(url.origin)) {
   report.gaps.push({type:'blocked-external-resource',origin:url.origin,path:url.pathname});return route.abort('blockedbyclient');
  }
  if(req.method()==='POST'&&url.origin===options.baseOrigin&&url.pathname==='/__nextjs_original-stack-frames')return route.continue();
  if(!['GET','HEAD'].includes(req.method())) {
   report.gaps.push({type:'blocked-non-api-write',method:req.method(),path:url.pathname});return route.abort('blockedbyclient');
  }
  return route.continue();
 });
 return {releaseModels:()=>releaseModels?.(),failLogs:()=>{options.failLogs=true;},failModels:()=>{options.failModels=true;},recoverModels:()=>{options.modelsRecovered=true;}};
}
module.exports={makeResolver,installRoutes};
