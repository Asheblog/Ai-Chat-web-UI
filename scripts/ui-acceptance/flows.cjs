'use strict';
const f=require('./fixtures.cjs');
async function step(report,name,action) {
 try{await action();report.checks.push({name,status:'passed'});}
 catch(e){report.checks.push({name,status:'failed',error:e.message});}
}
async function ready(page) {
 await page.locator('body').waitFor({state:'visible'});
 await page.evaluate(()=>document.fonts.ready);
 await page.locator('[aria-busy="true"]').first().waitFor({state:'hidden',timeout:5000}).catch(()=>{});
 const loading=page.getByText(/^(正在加载[^\n]*[….]|加载中[….]*)$/).first();
 if(await loading.isVisible())await loading.waitFor({state:'hidden',timeout:45000});
}
async function selectorFlow(page,report,capture,controls={}) {
 const trigger=page.getByRole('combobox',{name:'选择模型'}).first();
 if(!await trigger.isVisible()){report.gaps.push({type:'model-selector-trigger-not-visible'});return;}
 await step(report,'selector-open',async()=>{await trigger.click();await page.getByPlaceholder('搜索模型 / 厂商 / 能力').waitFor();});
 const search=page.getByPlaceholder('搜索模型 / 厂商 / 能力');
 if(!await search.isVisible())return;
 await capture('selector-open');
 await step(report,'selector-same-name-distinct-sources',async()=>{
  await search.fill('gpt-ui');
  const primary=page.getByRole('button',{name:f.LONG+' · Fixture 主连接',exact:true});
  const secondary=page.getByRole('button',{name:f.LONG+' · Fixture 备用连接',exact:true});
  if(!await primary.isVisible()||!await secondary.isVisible())throw new Error('跨连接同名模型未同时显示来源');
 });
 await step(report,'selector-empty-search',async()=>{await search.fill('ui-no-such-model-92871');await page.getByText(/没有找到|无匹配|暂无匹配|未找到|没有匹配/).first().waitFor();});
 await capture('selector-no-results');
 await search.fill('gpt-ui');
 await step(report,'selector-favorite-is-separate',async()=>{
  const row=page.locator('[data-model-row]').filter({has:page.getByRole('button',{name:f.LONG+' · Fixture 主连接',exact:true})});
  const favorite=row.getByRole('button',{name:'收藏',exact:true});await favorite.click();
  if(!await search.isVisible())throw new Error('收藏导致选择器关闭');
  await page.getByRole('button',{name:'取消收藏',exact:true}).first().waitFor();
 });
 await capture('selector-favorite');
 await step(report,'selector-refresh-stale-directory',async()=>{
  if(report.variant!=='models-refresh-error')return;
  controls.failModels();await page.getByRole('button',{name:/刷新模型|刷新/}).last().click();await page.getByRole('alert').first().waitFor();
  await page.getByRole('button',{name:f.LONG+' · Fixture 主连接',exact:true}).waitFor();
 });
 if(report.variant==='models-refresh-error')await capture('selector-refresh-error');
 await step(report,'selector-escape-focus-return',async()=>{
  await search.press('Escape');await search.waitFor({state:'hidden'});
  if(!await trigger.evaluate(e=>e===document.activeElement))throw new Error('Escape关闭后未回到触发器');
 });
 await step(report,'selector-keyboard-navigation',async()=>{
  await trigger.focus();await page.keyboard.press('Enter');await search.waitFor();await search.fill('Gemini');
  await search.press('ArrowDown');await page.keyboard.press('Enter');
  // A keyboard operation must actually select or move a visible focused option.
  const state=await page.evaluate(()=>({role:document.activeElement?.getAttribute('role'),expanded:document.querySelector('[aria-label="选择模型"]')?.getAttribute('aria-expanded')}));
  await search.waitFor({state:'hidden'});
  if(!/Gemini/.test(await trigger.innerText()))throw new Error('ArrowDown/Enter未选择搜索结果');
 });
 if(page.viewportSize().width<=390)await step(report,'selector-mobile-close',async()=>{
  if(!await search.isVisible())await trigger.click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  const close=dialog.getByRole('button',{name:/关闭|Close/i}).first();await close.click();await dialog.waitFor({state:'hidden'});
 });
}
async function runFlow(page,scenario,report,capture,controls={}) {
 const flow=scenario.flow;
 if(flow==='login'||flow==='register') {
  await step(report,flow+'-form',async()=>{await page.getByRole('textbox').first().fill('fixture_user');
   const passwords=page.locator('input[type="password"]');for(let i=0;i<await passwords.count();i++)await passwords.nth(i).fill('Fixture-Only-123!');});
  await capture('form-filled');
  await step(report,flow+'-submit-fixture',async()=>{await page.getByRole('button',{name:flow==='login'?'登录':'注册',exact:true}).click();
   if(flow==='login')await page.waitForURL('**/main');else await page.getByText(/Fixture 注册已提交审批|等待.*审批|注册.*成功/).first().waitFor();
  });await capture('form-result');return;
 }
 if(flow==='session') {
  await step(report,'select-existing-session',async()=>{
   await page.getByText(/请整理本周 UI 发布要点/).first().waitFor({timeout:30000});
  });
  await capture('messages');
 }
 if(['welcome','session'].includes(flow)&&['models-empty','models-error'].includes(scenario.variant)){
  await step(report,scenario.variant,async()=>{await page.getByRole('combobox',{name:'选择模型'}).first().click();
   if(scenario.variant==='models-error')await page.getByRole('alert').filter({hasText:/加载失败|503|模型目录|加载模型/}).first().waitFor({timeout:10000});
   else await page.getByText(/暂无可用模型|暂无模型|还没有可用模型/).first().waitFor();
  });await capture(scenario.variant);
  await step(report,scenario.variant+'-refresh-recovery',async()=>{controls.recoverModels();await page.getByRole('button',{name:/刷新模型|刷新/}).last().click();await page.getByPlaceholder('搜索模型 / 厂商 / 能力').filter({visible:true}).fill('gpt-ui');await page.getByRole('button',{name:f.LONG+' · Fixture 主连接',exact:true}).waitFor({timeout:10000});});
  await capture(scenario.variant+'-recovered');await page.keyboard.press('Escape');return;
 }
 if(['welcome','session'].includes(flow)) {
  const textarea=page.locator('textarea:visible').first();
  await step(report,'composer-input',async()=>{await textarea.fill('Fixture：请检查超长中文模型名与发送按钮位置，不实际发送。');});
  await capture('composer-filled');await selectorFlow(page,report,capture,controls);return;
 }
 if(flow==='personal') {
  for(const [id,label]of [['profile','个人资料与偏好'],['skills','个人 Skills'],['shares','分享管理'],['security','账号安全']].filter(([id])=>!process.argv.includes('--security-only')||id==='security')){
   const hashes={profile:'settings-personal-preferences',skills:'settings-personal-skills',shares:'settings-share-management',security:'settings-personal-security'};
   await step(report,'personal-'+id,async()=>{const toggle=page.getByRole('button',{name:'打开设置目录',exact:true});if(await toggle.isVisible())await toggle.click();await page.getByRole('button',{name:label,exact:true}).first().click();await page.locator('#'+hashes[id]).waitFor({timeout:6000});await ready(page);});
   if(id==='security')await step(report,'security-form-expanded',async()=>{await page.getByRole('button',{name:/安全设置（密码与登录）/}).click();await page.getByLabel('当前密码',{exact:true}).waitFor();await page.getByLabel('新密码',{exact:true}).waitFor();await page.getByLabel('确认新密码',{exact:true}).waitFor();});
   await capture('personal-'+id);
  }return;
 }
 if(flow==='system') {
  const leaves=[['overview','概览'],['connections','供应商与连接'],['models','模型管理'],['search-knowledge','搜索与知识库'],['extensions','能力扩展'],['users-registration','用户与注册'],['branding','品牌与界面'],['logs-audit','日志与审计'],['data-maintenance','数据与维护'],['reasoning-network','推理与网络']];
  for(const [key,label]of leaves.filter(([key])=>!process.argv.includes('--system-leaves')||process.argv[process.argv.indexOf('--system-leaves')+1].split(',').includes(key))){await step(report,'system-nav-'+key,async()=>{
   const toggle=page.getByRole('button',{name:'打开设置目录',exact:true});if(await toggle.isVisible())await toggle.click();
   const groups={connections:'模型与连接',models:'模型与连接','search-knowledge':'功能与工具',extensions:'功能与工具',branding:'系统与数据','logs-audit':'系统与数据','data-maintenance':'系统与数据','reasoning-network':'高级设置'};
   const group=groups[key]&&page.getByRole('button',{name:groups[key],exact:true});
   if(group&&await group.count()&&await group.getAttribute('aria-expanded')==='false')await group.click();
   const target=page.getByRole('button',{name:label,exact:true});
   if(await target.count()){await target.first().click();}
   else await page.getByRole('link',{name:label,exact:true}).first().click();
   await ready(page);
   const anchors={overview:'待你完成',connections:'快速接入',models:'模型目录与能力','search-knowledge':'搜索与知识库',extensions:'能力扩展','users-registration':'用户管理',branding:'品牌与界面','logs-audit':'审计结果','data-maintenance':'数据与维护','reasoning-network':'推理与网络'};
   await page.locator('[data-settings-scroll="content"]').getByText(anchors[key],{exact:true}).first().waitFor({timeout:45000});
   await page.getByText(/^正在加载设置模块[….]+$/).first().waitFor({state:'hidden',timeout:45000});
   report.checks.push({name:'system-content-'+key,status:'passed',anchor:anchors[key]});
  });await capture('system-'+key);}
  return;
 }
 if(flow==='logs-error'){await step(report,'logs-first-load-error',async()=>{await page.getByRole('alert').filter({hasText:'日志加载失败'}).waitFor({timeout:15000});});await capture('logs-first-error');return;}
 if(flow==='share-error'){await step(report,'share-error-readonly',async()=>{await page.getByText(/分享.*(不存在|失效|过期)|无法.*分享|未找到/).first().waitFor();if(await page.locator('textarea').count())throw new Error('失效分享出现输入框');});return;}
 if(flow==='logs-system') {
  await step(report,'logs-data-visible',async()=>{await page.getByText(f.logs[0].msg,{exact:true}).waitFor();});
  await step(report,'logs-ctx-expand',async()=>{await page.getByRole('button',{name:/展开日志上下文/}).first().click();await page.getByText(/折叠上下文应能展开/).first().waitFor();});
  await capture('logs-context');
  if(scenario.variant==='logs-refresh-error'){
   await step(report,'logs-refresh-error',async()=>{controls.failLogs();await page.getByRole('button',{name:/刷新/}).first().click();await page.getByRole('alert').filter({hasText:'日志加载失败'}).waitFor({timeout:15000});
    if(!await page.getByText(f.logs[0].msg,{exact:true}).isVisible())throw new Error('刷新失败后已有日志丢失');});
   await capture('logs-refresh-error');
  }return;
 }
 if(flow==='trace') {
  await step(report,'trace-detail',async()=>{await page.getByRole('button',{name:'查看追踪 #9401',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByText('request.received',{exact:true}).waitFor();});
  await capture('trace-detail');return;
 }
 if(flow==='battle-multi') {
  if(scenario.variant==='battle-result')await step(report,'battle-result',async()=>{await page.getByText('Fixture 通过',{exact:false}).first().waitFor();});
  else {
   await step(report,'battle-config-step',async()=>{await page.getByRole('heading',{name:/选择参赛模型/}).waitFor({timeout:15000});});
   await capture('battle-config');
   await step(report,'battle-question-step',async()=>{
    await page.getByRole('combobox',{name:'选择模型'}).nth(0).click();
    await page.getByPlaceholder('搜索模型 / 厂商 / 能力').filter({visible:true}).fill('gpt-ui');
    await page.getByRole('button',{name:f.LONG+' · Fixture 主连接',exact:true}).click();
    await page.getByPlaceholder('搜索模型 / 厂商 / 能力').waitFor({state:'hidden'});
    await page.getByRole('combobox',{name:'选择模型'}).nth(1).click();
    await page.getByPlaceholder('搜索模型 / 厂商 / 能力').filter({visible:true}).fill('Claude');
    await page.getByRole('button',{name:'Claude Fixture 中文推理 · Fixture 推理连接',exact:true}).click();
    await page.getByRole('button',{name:/下一步/}).click();
    await page.getByPlaceholder('输入要测试的问题，例如：请计算 1+1=?').fill('Fixture：请解释长模型名截断与发送按钮保留宽度的设计原因。');
    await page.getByPlaceholder('输入正确答案，裁判模型将根据此答案评判各模型输出').fill('Fixture：优先保证主要动作可达，完整身份在选择器查看。');
   });await capture('battle-question');
  }
  await capture(scenario.variant==='battle-result'?'battle-result':'battle-config');return;
 }
 if(flow==='battle'){await step(report,'battle-mode-entry',async()=>{await page.getByRole('heading',{name:'模型大乱斗'}).waitFor();await page.getByRole('link',{name:/多模型|进入/}).first().waitFor();});return;}
 if(flow==='logs'){await step(report,'logs-index',async()=>{await page.getByRole('heading').filter({hasText:/日志/}).first().waitFor();});return;}
 if(flow==='share')await step(report,'share-readonly',async()=>{
  await page.waitForFunction(()=>{const all=[...document.querySelectorAll('.markdown-body')];return all.some(e=>e.querySelector('h2')&&e.querySelector('code')&&e.querySelector('table'))&&all.every(e=>!e.classList.contains('markdown-body--pending')&&!e.querySelector('[data-markdown-fallback]'));},{},{timeout:45000});
  await page.getByRole('heading',{name:'Fixture · 公开分享中文会话'}).first().waitFor();
  await page.getByText(/请整理本周 UI 发布要点/).first().waitFor();
  if(await page.locator('textarea').count())throw new Error('公开分享出现输入框');
 });
}
module.exports={ready,step,runFlow};
