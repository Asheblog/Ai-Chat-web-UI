'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {installRoutes}=require('./routes.cjs');
const {measure,evaluateGeometry}=require('./measure.cjs');
const {runFlow,ready}=require('./flows.cjs');
const {scenarios,viewports,dark}=require('./manifest.cjs');
const ROOT=path.resolve(__dirname,'../..');
const OUTPUT=path.join(ROOT,'output/playwright/ui-v2');
const arg=(key,fallback)=>{const i=process.argv.indexOf('--'+key);return i<0?fallback:process.argv[i+1];};
const csv=(key,fallback)=>arg(key,fallback).split(',');
const isExpectedHttp=(id,status,pathname)=>(id==='share-error'&&status===404&&pathname==='/share/ui-v2-missing')||status===503&&(({
 'models-error':'/api/catalog/models','models-refresh-error':'/api/catalog/models',
 'logs-first-error':'/api/system-logs','logs-refresh-error':'/api/system-logs',
})[id]===pathname);
function expectedConsole(scenario,msg){
 if(msg.type!=='console')return false;
 const status=msg.text.match(/^Failed to load resource: the server responded with a status of (503|404) /);
 if(status){try{return isExpectedHttp(scenario.id,Number(status[1]),new URL(msg.location.url).pathname);}catch{return false;}}
 const logged=msg.text.match(/\[ERROR\] HTTP Error Request failed with status code (503) in [0-9]+ms \{url: (https?:\/\/[^, ]+), status: 503,/);
 if(logged){try{return isExpectedHttp(scenario.id,503,new URL(logged[2]).pathname);}catch{return false;}}
 return false;
}
function runtime() {
 const store=path.join(ROOT,'node_modules/.pnpm');
 const packages=fs.readdirSync(store).filter(n=>/^playwright-core@/.test(n)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
 const cache=process.env.PLAYWRIGHT_BROWSERS_PATH||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData/Local'),'ms-playwright');
 for(const name of packages){
  const modulePath=path.join(store,name,'node_modules/playwright-core');
  const browsers=JSON.parse(fs.readFileSync(path.join(modulePath,'browsers.json'),'utf8')).browsers;
  const revision=browsers.find(b=>b.name==='chromium')?.revision;
  const candidates=[path.join(cache,'chromium-'+revision,'chrome-win64/chrome.exe'),path.join(cache,'chromium-'+revision,'chrome-win/chrome.exe'),
   path.join(cache,'chromium-'+revision,'chrome-linux64/chrome'),path.join(cache,'chromium-'+revision,'chrome-linux/chrome'),path.join(cache,'chromium-'+revision,'chrome-mac/Chromium.app/Contents/MacOS/Chromium')];
  const executable=process.env.UI_ACCEPTANCE_CHROMIUM||candidates.find(p=>fs.existsSync(p));
  if(executable&&fs.existsSync(executable))return {playwright:require(modulePath),modulePath,executable,revision};
 }
 throw new Error('No installed playwright-core + cached Chromium pair. Set UI_ACCEPTANCE_CHROMIUM to an existing executable; no downloads are performed.');
}
function matrix() {
 const ids=csv('scenarios','all'),widths=csv('widths','1440,390,320').map(Number),themes=csv('themes','light,dark');
 const selected=ids.includes('all')?scenarios:scenarios.filter(s=>ids.includes(s.id));
 if(!selected.length)throw new Error('No scenario selected');
 return selected.flatMap(s=>viewports.filter(v=>widths.includes(v.width)).flatMap(viewport=>themes.filter(t=>t==='light'||dark.includes(s.id)||arg('force-dark','false')==='true').map(theme=>({...s,viewport,theme}))));
}
function saveReport(out,report){
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 const lines=['# UI acceptance — '+report.phase,'','All accounts, API data and model results are synthetic fixtures.','',
  '| Scenario | Checks | Findings | API gaps | Screenshot states |','|---|---:|---:|---:|---:|',
  ...report.runs.map(r=>'| '+r.id+' | '+r.checks.filter(c=>c.status==='passed').length+'/'+r.checks.length+' | '+r.findings.length+' | '+r.gaps.length+' | '+r.screenshots.length+' |'),
  '','## Acceptance gaps',...report.runs.flatMap(r=>r.gaps.map(g=>'- '+r.id+': '+JSON.stringify(g))),
  '','## Failed checks / findings',...report.runs.flatMap(r=>[...r.checks.filter(c=>c.status==='failed'),...r.findings].map(g=>'- '+r.id+': '+JSON.stringify(g))),
  '','## Console / network evidence',...report.runs.flatMap(r=>[...r.console,...r.resources].map(e=>'- '+r.id+': '+JSON.stringify(e))),
  '','## Scope','Browser route fixtures test rendering and interactions, not real backend persistence or model correctness.',
  'Public share success needs the lead-owned localhost SSR fixture server and existing server-share environment configuration.'];
 fs.writeFileSync(path.join(out,'report.md'),lines.join('\n')+'\n');
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Fixture UI acceptance</title><style>body{font:15px system-ui;margin:32px;background:#f1f4f3;color:#17221f}h1{font-size:28px}section{margin:24px 0;padding:20px;background:white;border:1px solid #cad4d0}img{max-width:100%;max-height:700px;border:1px solid #bdc9c4}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#176652}</style><h1>'+esc(report.phase)+' · UI Fixture 验收</h1><p>全部账户、模型和内容均为 synthetic fixture；无模型请求透传。</p>'+report.runs.map(r=>'<section><h2>'+esc(r.id)+'</h2><pre>'+esc(JSON.stringify({checks:r.checks,findings:r.findings,gaps:r.gaps},null,2))+'</pre>'+r.screenshots.map(s=>'<details><summary>'+esc(s.state)+'</summary><a href="'+esc(s.file)+'"><img src="'+esc(s.file)+'" alt="'+esc(s.state)+'"></a></details>').join('')+'</section>').join('')+'</html>');
}
async function main(){
 const runs=matrix();
 if(process.argv.includes('--list')){console.log(runs.map(s=>s.id+' '+s.viewport.width+' '+s.theme).join('\n'));return;}
 const phase=arg('phase','baseline'),stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const out=path.resolve(OUTPUT,arg('out',phase+'-'+stamp));
 if(out!==OUTPUT&&!out.startsWith(OUTPUT+path.sep))throw new Error('Output must stay under output/playwright/ui-v2');
 const base=new URL(arg('base','http://localhost:3000'));
 if(!['localhost','127.0.0.1'].includes(base.hostname)||base.port!=='3000')throw new Error('UI base must be localhost:3000 or 127.0.0.1:3000');
 const rt=runtime();fs.mkdirSync(out,{recursive:true});
 const report={phase,fixture:true,startedAt:new Date().toISOString(),runtime:{modulePath:rt.modulePath,executable:rt.executable,revision:rt.revision},runs:[]};
 const browser=await rt.playwright.chromium.launch({executablePath:rt.executable,headless:!process.argv.includes('--headed')});
 try{for(const scenario of runs){
  const id=[scenario.id,scenario.viewport.width,scenario.theme].join('-');
  const item={id,path:scenario.path,actor:scenario.actor,variant:scenario.variant||'default',fixture:true,checks:[],findings:[],gaps:[],api:[],console:[],resources:[],screenshots:[],measurements:[]};
  report.runs.push(item);console.log('RUN '+id);
  const context=await browser.newContext({viewport:scenario.viewport,colorScheme:scenario.theme,locale:'zh-CN',timezoneId:'Asia/Shanghai',serviceWorkers:'block'});
  const controls=await installRoutes(context,{...scenario,baseOrigin:base.origin},item);
  await context.addInitScript(({theme,result})=>{localStorage.setItem('theme',theme);if(result)sessionStorage.setItem('battle:last-viewed-run-id','9201');},{theme:scenario.theme,result:scenario.variant==='battle-result'});
  const page=await context.newPage();page.setDefaultTimeout(4500);page.setDefaultNavigationTimeout(60000);
  page.on('console',msg=>{if(msg.type()==='error'){const entry={type:'console',text:msg.text(),location:msg.location()};entry.expected=expectedConsole(scenario,entry);item.console.push(entry);}});
  page.on('requestfailed',req=>{const error=req.failure()?.errorText;if(error!=='net::ERR_ABORTED')item.resources.push({type:'requestfailed',path:new URL(req.url()).pathname,error,expected:false});});
  page.on('pageerror',e=>item.console.push({type:'pageerror',text:e.message,stack:e.stack,expected:false}));
  const cdp=await context.newCDPSession(page);await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown',event=>item.console.push({type:'runtime-exception',details:event.exceptionDetails,expected:false}));
  page.on('response',res=>{if(res.status()>=400){const u=new URL(res.url());const expected=isExpectedHttp(scenario.id,res.status(),u.pathname);item.resources.push({path:u.pathname,status:res.status(),api:u.pathname.startsWith('/api/'),expected});}});
  const capture=async state=>{
   await ready(page);const m=await measure(page);item.measurements.push({state,...m});evaluateGeometry(m,item,state);
   const file=id+'--'+state+'.png';await page.screenshot({path:path.join(out,file),fullPage:false,animations:'disabled'});item.screenshots.push({state,file});saveReport(out,report);
  };
  try{
   await page.goto(new URL(scenario.path,base).href,{waitUntil:'domcontentloaded'});
   await ready(page);
   if(scenario.variant==='models-loading'){await page.getByRole('combobox',{name:'选择模型'}).first().waitFor({timeout:30000});await page.getByRole('combobox',{name:'选择模型'}).first().click();await capture('models-loading');const loaded=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/catalog/models');controls.releaseModels();await loaded;await page.keyboard.press('Escape');}
   const anchor=['welcome','session'].includes(scenario.flow)?page.locator('textarea:visible').first():['personal','system'].includes(scenario.flow)?page.getByRole('navigation',{name:'设置导航'}):null;
   if(anchor){if(['personal','system'].includes(scenario.flow)&&scenario.viewport.width<768)await page.getByRole('button',{name:'打开设置目录',exact:true}).waitFor({timeout:30000});else await anchor.waitFor({timeout:30000});}
   if(['personal','system'].includes(scenario.flow))await page.locator('[data-settings-scroll="content"]').waitFor({timeout:30000});
   await capture('initial');if(process.argv.includes('--geometry-only')){await page.locator('textarea:visible').first().fill('Fixture：单环焦点、长模型名、发送与760px会话宽度复核。');await capture('composer-filled');await page.getByRole('combobox',{name:'选择模型'}).first().click();await capture('selector-open');}else await runFlow(page,scenario,item,capture,controls);await capture('final');
  }catch(e){item.findings.push({type:'scenario-error',error:e.message});await capture('error').catch(()=>{});}
  finally{controls.releaseModels();item.url=page.url();item.bodyExcerpt=(await page.locator('body').innerText().catch(()=>'' )).slice(0,12000);await context.close();saveReport(out,report);}
 }
 }finally{await browser.close();}
 report.finishedAt=new Date().toISOString();saveReport(out,report);
 const fail=report.runs.reduce((n,r)=>n+r.findings.length+r.gaps.length+r.checks.filter(c=>c.status==='failed').length+r.console.filter(c=>!c.expected).length+r.resources.filter(x=>!x.expected).length,0);
 console.log(JSON.stringify({out,runs:report.runs.length,issues:fail,fixture:true},null,2));if(fail)process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=2;});
module.exports={runtime,matrix};
