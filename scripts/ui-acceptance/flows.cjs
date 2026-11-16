'use strict';
const f=require('./fixtures.cjs');

// ── 设置页契约 ───────────────────────────────────────────────────────────────
// 侧栏是唯一导航：叶子由 data-leaf-key 标识，选中态由 aria-current=page 标出。
// 窄屏（<768）时导航在 Sheet 门户里，关闭即卸载，因此“当前页”只能在下次打开时核对。
const NAV_SEL = 'nav[aria-label="设置导航"]';
const CONTENT_SEL = '[data-settings-scroll="content"]';
const MODULE_LOADING = /^正在加载设置模块[….]+$/;

/** 系统设置叶子：key 与各页真实标题（不是共用页头文案）。 */
const SYSTEM_LEAVES = [
 ['overview','概览'],
 ['connections','供应商与连接'],
 ['models','模型管理'],
 ['session-defaults','会话默认配置'],
 ['search-knowledge','搜索与知识库'],
 ['extensions','工具与扩展'],
 ['extensions-mcp','MCP 服务'],
 ['extensions-skills','Skill'],
 ['extensions-tools','内置工具'],
 ['extensions-extra','对话增强'],
 ['users-registration','用户与访问'],
 ['data-maintenance','数据与维护'],
 ['logs-audit','Skill 审计日志'],
 ['reasoning-network','生成与网络'],
 ['branding','外观与站点'],
];

/** 个人设置叶子：key、页面标题（null 表示没有独立标题）、URL hash 锚点。 */
const PERSONAL_LEAVES = [
 ['profile','个人资料','settings-personal-preferences'],
 ['skills','个人 Skills','settings-personal-skills'],
 ['shares','最近分享','settings-share-management'],
 ['security',null,'settings-personal-security'],
];

/** 扩展页内的次级标签：只有 MCP 与 Skill 有，其余段没有第二列导航。 */
const SEGMENT_TABS = {
 mcp:{ label:'MCP 服务次级标签', keys:['installations','connections','secrets','tools','bindings'], labels:['安装模板','连接','凭据','工具','绑定'], cardPrefix:'extensions:mcp-' },
 skills:{ label:'Skill 次级标签', keys:['install','approvals','versions','bindings'], labels:['安装','待审批','版本','绑定'], cardPrefix:'extensions:skill-' },
};
const SEGMENT_TABLIST_LABELS = [SEGMENT_TABS.mcp.label, SEGMENT_TABS.skills.label];

async function step(report,name,action) {
 try{await action();report.checks.push({name,status:'passed'});}
 catch(e){report.checks.push({name,status:'failed',error:e.message});}
}
async function ready(page) {
 // body 在窄屏布局下高度为 0（内容由固定高度的 main 承载），不能再用 body 可见性判就绪
 await page.evaluate(()=>document.readyState==='loading'?new Promise(r=>document.addEventListener('DOMContentLoaded',()=>r(null),{once:true})):null);
 await page.evaluate(()=>document.fonts.ready);
 await page.locator('[aria-busy="true"]').first().waitFor({state:'hidden',timeout:5000}).catch(()=>{});
 const loading=page.getByText(/^(正在加载[^\n]*[….]|加载中[….]*)$/).first();
 if(await loading.isVisible())await loading.waitFor({state:'hidden',timeout:45000});
}

// ── 设置导航操作 ─────────────────────────────────────────────────────────────

async function navVisible(page){
 const nav=page.locator(NAV_SEL).first();
 return (await nav.count())>0 && (await nav.isVisible());
}

/** 打开设置导航：桌面为常驻 aside，窄屏为 Sheet 门户（关闭即卸载）。 */
async function openSettingsNav(page){
 if(await navVisible(page))return 'inline';
 const trigger=page.getByRole('button',{name:'打开设置目录',exact:true});
 await trigger.waitFor({timeout:20000});
 await trigger.click();
 await page.locator(NAV_SEL).first().waitFor({state:'visible',timeout:20000});
 // Sheet 有开合动画：等一帧稳定后再点叶子，否则点击会和挂载/卸载撞车
 await page.waitForTimeout(250);
 return 'sheet';
}

/** 展开全部折叠分组：分组名会变，按 aria-expanded 状态遍历，不写死标签。 */
async function expandSettingsGroups(page){
 for(let pass=0;pass<8;pass+=1){
  const collapsed=page.locator(NAV_SEL+' [aria-expanded="false"]');
  const count=await collapsed.count();
  if(!count)return;
  for(let i=0;i<count;i+=1){const group=collapsed.nth(i);if(await group.isVisible())await group.click();}
  await page.waitForTimeout(120);
 }
}

async function leafLocator(page,key){
 return page.locator(NAV_SEL+' button[data-leaf-key="'+key+'"]').first();
}

async function clickLeaf(page,key){
 let lastError=null;
 for(let attempt=0;attempt<3;attempt+=1){
  await openSettingsNav(page);
  await expandSettingsGroups(page);
  const leaf=await leafLocator(page,key);
  if(!await leaf.count())throw new Error('侧栏缺少叶子 '+key);
  try{
   // click 自带滚动定位；显式 scrollIntoViewIfNeeded 会在窄屏 Sheet 卸载时撞到 detached 节点
   await leaf.click({timeout:8000});
   await page.locator(CONTENT_SEL).first().waitFor({timeout:30000});
   await page.getByText(MODULE_LOADING).first().waitFor({state:'hidden',timeout:45000}).catch(()=>{});
   await ready(page);
   return leaf;
  }catch(e){
   lastError=e;
   await page.keyboard.press('Escape').catch(()=>{});
   await page.waitForTimeout(300);
  }
 }
 throw lastError||new Error('点击叶子失败：'+key);
}

/** 选中态：窄屏需先把 Sheet 打开，因为关闭时导航已卸载。 */
async function assertLeafCurrent(page,key){
 const mode=await openSettingsNav(page);
 await expandSettingsGroups(page);
 const leaf=await leafLocator(page,key);
 const current=await leaf.getAttribute('aria-current');
 if(current!=='page')throw new Error('叶子 '+key+' 未标记 aria-current=page（实际 '+current+'）');
 if((await leaf.getAttribute('data-active'))===null)throw new Error('叶子 '+key+' 缺少 data-active');
 // 窄屏：Sheet 是模态的，开着时内容区被 aria-hidden，后续 role 查询会全部落空。核对完立即收起。
 if(mode==='sheet'){
  await page.keyboard.press('Escape');
  await page.locator(NAV_SEL).first().waitFor({state:'detached',timeout:15000}).catch(()=>{});
 }
 return leaf;
}

async function assertContentHeading(page,title){
 const content=page.locator(CONTENT_SEL).first();
 const heading=content.getByRole('heading',{name:title,exact:true}).first();
 await heading.waitFor({timeout:45000});
 return heading;
}

/** 内容区不得出现第二列导航（SectionRail），也不得重复当前页标记。 */
async function assertSidebarIsOnlyNavigation(page){
 const content=page.locator(CONTENT_SEL).first();
 const navs=await content.locator('nav').count();
 if(navs)throw new Error('内容区出现第二列导航：nav 元素 '+navs+' 个');
 const labels=await content.locator('[role="tablist"]').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().height>0).map(n=>n.getAttribute('aria-label')));
 const stray=labels.filter(label=>!SEGMENT_TABLIST_LABELS.includes(label));
 if(stray.length)throw new Error('内容区出现额外可见 tablist：'+JSON.stringify(stray));
 const current=await content.locator('[aria-current="page"]').count();
 if(current)throw new Error('内容区重复出现 aria-current=page：'+current);
}

async function assertSheetClosed(page){
 const nav=page.locator(NAV_SEL).first();
 // Sheet 关闭有过渡：先等它卸载，再判定，避免把动画中间态当成“没收起”
 if(await navVisible(page)){
  await nav.waitFor({state:'detached',timeout:5000}).catch(()=>{});
 }
 if(await navVisible(page))throw new Error('选择叶子后设置目录没有收起');
 const trigger=page.getByRole('button',{name:'打开设置目录',exact:true});
 if(!await trigger.count())throw new Error('收起后缺少“打开设置目录”触发器');
}

async function segmentTab(page,tablistLabel,tabLabel){
 const list=page.getByRole('tablist',{name:tablistLabel});
 await list.waitFor({timeout:20000});
 const tab=list.getByRole('tab',{name:tabLabel,exact:true}).first();
 await tab.waitFor({timeout:15000});
 return tab;
}

async function activeSegmentTab(page,tablistLabel){
 const list=page.getByRole('tablist',{name:tablistLabel});
 const selected=list.locator('[role="tab"][aria-selected="true"]');
 await selected.first().waitFor({timeout:15000});
 return (await selected.first().innerText()).trim();
}

function leavesFilter(){
 if(!process.argv.includes('--system-leaves'))return null;
 return (process.argv[process.argv.indexOf('--system-leaves')+1]||'').split(',').filter(Boolean);
}

// ── 设置子流程 ──────────────────────────────────────────────────────────────

async function segmentTabsFlow(page,report,capture,segmentKey){
 const spec=SEGMENT_TABS[segmentKey];
 for(let i=0;i<spec.labels.length;i+=1){
  const label=spec.labels[i], key=spec.keys[i];
  await step(report,'segment-'+segmentKey+'-'+key,async()=>{
   const tab=await segmentTab(page,spec.label,label);
   await tab.click();
   const list=page.getByRole('tablist',{name:spec.label});
   await list.locator('[role="tab"][aria-selected="true"]').first().waitFor({state:'visible',timeout:15000});
   if((await activeSegmentTab(page,spec.label))!==label)throw new Error('点击「'+label+'」后未成为选中标签');
   const panel=page.locator('[data-card-key="'+spec.cardPrefix+key+'"]').first();
   await panel.waitFor({timeout:25000});
   if(!await panel.isVisible())throw new Error('「'+label+'」面板不可见');
  });
  await capture('segment-'+segmentKey+'-'+key);
 }
}

async function searchLocate(page,report,capture,args){
 await step(report,'search-locate-'+args.leafKey,async()=>{
  await openSettingsNav(page);
  const input=page.getByRole('textbox',{name:'搜索设置'});
  await input.click();
  await input.fill(args.query);
  const option=page.getByRole('option',{name:new RegExp(args.query)}).first();
  await option.waitFor({timeout:20000});
  await option.click();
  await page.waitForFunction(key=>{
   const el=document.querySelector('[data-card-key="'+key+'"]');
   return !!el && el.classList.contains('settings-flash');
  },args.cardKey,{timeout:25000});
  await page.locator(CONTENT_SEL+' [data-card-key="'+args.cardKey+'"]').first().waitFor({timeout:20000});
  if(args.tabLabel&&args.tablistLabel&&(await activeSegmentTab(page,args.tablistLabel))!==args.tabLabel)
   throw new Error('搜索「'+args.query+'」未切到「'+args.tabLabel+'」标签');
  await assertLeafCurrent(page,args.leafKey);
  const box=await page.locator(CONTENT_SEL+' [data-card-key="'+args.cardKey+'"]').first().boundingBox();
  const view=await page.locator(CONTENT_SEL).first().boundingBox();
  if(!box||!view)throw new Error('定位卡没有渲染出可视区域');
  if(box.y+box.height<view.y||box.y>view.y+view.height)
   throw new Error('定位卡滚出内容视口：card.y='+Math.round(box.y)+' view='+Math.round(view.y)+'..'+Math.round(view.y+view.height));
  // 窄屏：搜索框在 Sheet 里，截图前先收起目录，画面才落在被定位的卡上
  if(await navVisible(page)){
   await page.keyboard.press('Escape');
   await page.locator(NAV_SEL).first().waitFor({state:'detached',timeout:15000}).catch(()=>{});
  }
 });
 await capture('search-'+args.leafKey);
}

async function draftRoundTrip(page,report,capture){
 await step(report,'skill-draft-roundtrip',async()=>{
  await clickLeaf(page,'extensions-skills');
  const install=await segmentTab(page,SEGMENT_TABS.skills.label,'安装');
  await install.click();
  const source=page.getByPlaceholder('owner/repo@ref[:subdir] 或 github.com/.../SKILL.md');
  await source.waitFor({timeout:20000});
  await source.fill('fixture-org/fixture-skill@main');
  await capture('skill-draft-filled');
  await clickLeaf(page,'extensions-tools');
  await clickLeaf(page,'extensions-skills');
  await (await segmentTab(page,SEGMENT_TABS.skills.label,'安装')).click();
  const again=page.getByPlaceholder('owner/repo@ref[:subdir] 或 github.com/.../SKILL.md');
  await again.waitFor({timeout:20000});
  const value=await again.inputValue();
  if(value!=='fixture-org/fixture-skill@main')throw new Error('切叶子后 Skill 安装草稿丢失："'+value+'"');
 });
 await capture('skill-draft-restored');
}

async function drawerControls(page,report,capture){
 await step(report,'drawer-open-close-focus',async()=>{
  const trigger=page.getByRole('button',{name:'打开设置目录',exact:true});
  await trigger.click();
  await page.locator(NAV_SEL).first().waitFor({state:'visible',timeout:20000});
  await capture('drawer-open');
  await page.getByRole('button',{name:'收起设置目录',exact:true}).click();
  await page.locator(NAV_SEL).first().waitFor({state:'detached',timeout:15000});
  if(!await trigger.evaluate(el=>el===document.activeElement))throw new Error('关闭后焦点没有回到“打开设置目录”');
 });
 await step(report,'drawer-escape-focus',async()=>{
  const trigger=page.getByRole('button',{name:'打开设置目录',exact:true});
  await trigger.click();
  await page.locator(NAV_SEL).first().waitFor({state:'visible',timeout:20000});
  await page.keyboard.press('Escape');
  await page.locator(NAV_SEL).first().waitFor({state:'detached',timeout:15000});
  if(!await trigger.evaluate(el=>el===document.activeElement))throw new Error('Escape 关闭后焦点没有回到触发器');
 });
 await capture('drawer-closed');
}

// ── 既有流程（未改动） ──────────────────────────────────────────────────────
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
  const securityOnly=process.argv.includes('--security-only');
  for(const [key,title,hash] of PERSONAL_LEAVES.filter(leaf=>!securityOnly||leaf[0]==='security')){
   await step(report,'personal-'+key,async()=>{
    await clickLeaf(page,key);
    if(page.viewportSize().width<768)await assertSheetClosed(page);
    if(title)await assertContentHeading(page,title);
    await page.locator('#'+hash).waitFor({timeout:15000});
    await assertSidebarIsOnlyNavigation(page);
    await assertLeafCurrent(page,key);
   });
   if(key==='security')await step(report,'security-form-expanded',async()=>{
    await page.getByRole('button',{name:/安全设置（密码与登录）/}).click();
    await page.getByLabel('当前密码',{exact:true}).waitFor();
    await page.getByLabel('新密码',{exact:true}).waitFor();
    await page.getByLabel('确认新密码',{exact:true}).waitFor();
   });
   await capture('personal-'+key);
  }
  return;
 }

 if(flow==='system') {
  const filter=leavesFilter();
  const narrow=page.viewportSize().width<768;
  for(const [key,title] of SYSTEM_LEAVES.filter(leaf=>!filter||filter.includes(leaf[0]))){
   await step(report,'system-nav-'+key,async()=>{
    await clickLeaf(page,key);
    if(narrow)await assertSheetClosed(page);
    await assertContentHeading(page,title);
    await assertSidebarIsOnlyNavigation(page);
    await assertLeafCurrent(page,key);
   });
   await capture('system-'+key);
   if(key==='extensions-mcp'&&(!filter||filter.includes('extensions-mcp'))){
    await step(report,'extensions-mcp-empty-state',async()=>{
     const panel=page.locator('[data-card-key="extensions:mcp-installations"]').first();
     await panel.waitFor({timeout:20000});
     await panel.getByText(/暂无安装模板|还没有安装|暂无/).first().waitFor({timeout:15000});
    });
    await capture('extensions-mcp-empty');
    if(!process.argv.includes('--skip-segment-tabs'))await segmentTabsFlow(page,report,capture,'mcp');
   }
   if(key==='extensions-skills'&&(!filter||filter.includes('extensions-skills'))){
    if(!process.argv.includes('--skip-segment-tabs'))await segmentTabsFlow(page,report,capture,'skills');
   }
  }
  if(!filter||filter.includes('extensions-mcp'))await searchLocate(page,report,capture,{query:'MCP 凭据',cardKey:'extensions:mcp-secrets',leafKey:'extensions-mcp',tablistLabel:SEGMENT_TABS.mcp.label,tabLabel:'凭据'});
  if(!filter||filter.includes('extensions-skills'))await searchLocate(page,report,capture,{query:'绑定策略',cardKey:'extensions:skill-bindings',leafKey:'extensions-skills',tablistLabel:SEGMENT_TABS.skills.label,tabLabel:'绑定'});
  if(!filter||filter.includes('extensions-skills'))await draftRoundTrip(page,report,capture);
  if(narrow)await drawerControls(page,report,capture);
  return;
 }

 if(flow==='system-states') {
  const variant=scenario.variant;
  if(variant==='settings-loading'){
   await step(report,'settings-loading-skeleton',async()=>{
    // SectionFrame 的骨架（aria-busy）只出现在 内置工具 / 对话增强 这类卡片列表段
    await clickLeaf(page,'extensions-tools');
    const skeleton=page.locator(CONTENT_SEL+' [aria-busy="true"]').filter({visible:true}).first();
    await skeleton.waitFor({timeout:25000});
   });
   await capture('settings-loading');
   await step(report,'settings-loading-release',async()=>{
    controls.releaseSettings();
    await assertContentHeading(page,'内置工具');
    await page.locator(CONTENT_SEL+' [aria-busy="true"]').filter({visible:true}).first().waitFor({state:'hidden',timeout:30000}).catch(()=>{});
   });
   await capture('settings-loading-ready');
   return;
  }
  if(variant==='settings-error'){
   await step(report,'settings-error-state',async()=>{
    await clickLeaf(page,'extensions-tools');
    const content=page.locator(CONTENT_SEL).first();
    await content.getByText(/Fixture 系统设置暂不可用/).filter({visible:true}).first().waitFor({timeout:25000});
    await content.getByRole('button',{name:'重试',exact:true}).filter({visible:true}).first().waitFor({timeout:15000});
   });
   await capture('settings-error');
   await step(report,'settings-error-retry-recovers',async()=>{
    controls.recoverSettings();
    await page.locator(CONTENT_SEL).getByRole('button',{name:'重试',exact:true}).filter({visible:true}).first().click();
    await assertContentHeading(page,'内置工具');
    await page.locator(CONTENT_SEL).getByText(/Fixture 系统设置暂不可用/).filter({visible:true}).first().waitFor({state:'hidden',timeout:20000}).catch(()=>{});
   });
   await capture('settings-error-recovered');
   return;
  }
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
