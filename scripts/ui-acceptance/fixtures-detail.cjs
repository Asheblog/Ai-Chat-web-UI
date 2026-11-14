'use strict';
const {AT,LONG,models} = require('./fixtures.cjs');
const stats = {totalModels:2,runsPerModel:1,passK:1,judgeThreshold:0.8,passModelCount:1,accuracy:0.5,
 modelStats:models.slice(0,2).map((m,i)=>({modelId:m.id,connectionId:m.connectionId,rawId:m.rawId,passAtK:i===0,passCount:i===0?1:0,accuracy:i===0?1:0,judgedCount:1,totalAttempts:1,judgeErrorCount:0}))};
const battle = {id:9201,mode:'multi_model',title:'Fixture · 中文回答质量对比',prompt:{text:'解释为什么长模型名应截断，而发送按钮保持固定。',images:[]},
 expectedAnswer:{text:'保留关键动作可达性，模型身份仍能通过选择器完整查看。',images:[]},judgeModelId:'claude-ui',judgeConnectionId:13,judgeRawId:'claude-ui',
 judgeModelLabel:'Claude Fixture 中文推理',judgeThreshold:0.8,runsPerModel:1,passK:1,status:'completed',createdAt:AT,updatedAt:AT,summary:stats,
 config:{mode:'multi_model',models:models.slice(0,2).map(m=>({modelId:m.id,connectionId:m.connectionId,rawId:m.rawId}))},
 results:models.slice(0,2).map((m,i)=>({id:9301+i,battleRunId:9201,questionIndex:0,modelId:m.id,modelLabel:LONG,connectionId:m.connectionId,rawId:m.rawId,attemptIndex:0,
 output:i===0?'## Fixture 通过\n优先保证主要动作，模型名称省略但身份不丢失。':'Fixture 待改进：模型文字过长时需要保留发送空间。',usage:{prompt_tokens:128,completion_tokens:90,total_tokens:218},durationMs:1200+i*450,
 judgeStatus:'success',judgePass:i===0,judgeScore:i===0?0.95:0.65,judgeReason:i===0?'内容完整、可操作。':'遗漏键盘焦点说明。',judgeFallbackUsed:false})),live:{attempts:[]}};
const trace = {id:9401,sessionId:9101,messageId:91012,clientMessageId:'fixture-msg',actor:'Fixture 管理员',status:'completed',traceLevel:'debug',
 startedAt:AT,endedAt:AT,durationMs:1280,eventCount:3,metadata:{fixture:true,model:LONG},latexTrace:null};
const events = [{id:1,seq:1,eventType:'request.received',payload:{fixture:true,sessionId:9101},timestamp:AT},
 {id:2,seq:2,eventType:'tool.completed',payload:{tool:'web_search',durationMs:280,中文说明:'这是离线演示工具状态'},timestamp:AT},
 {id:3,seq:3,eventType:'response.completed',payload:{tokens:218,durationMs:1280},timestamp:AT}];
module.exports = {battle,trace,events};
