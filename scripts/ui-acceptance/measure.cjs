'use strict';
async function measure(page) {
 return page.evaluate(()=>{
  const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
  const vw=document.documentElement.clientWidth,vh=innerHeight;
  const all=[...document.querySelectorAll('body *')].filter(visible);
  const offenders=all.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>vw+2||r.left< -2);})
   .slice(0,18).map(e=>({tag:e.tagName,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),text:(e.textContent||'').slice(0,80),rect:rect(e)}));
  const input=all.find(e=>e.tagName==='TEXTAREA');
  // Seam selectors win when implementation offers them; semantic fallback uses the actual composer root.
  const composer=all.find(e=>e.matches('[data-testid="chat-composer"],[data-composer]')&&input&&e.contains(input))||input?.closest('.composer-shell')||input?.closest('.composer-inner-editor');
  const within=composer?[...composer.querySelectorAll('button')].filter(visible):[];
  const send=within.find(e=>/^(发送|停止|停止生成)$/.test(e.getAttribute('aria-label')||e.textContent?.trim()||''));
  const model=within.find(e=>e.getAttribute('role')==='combobox'&&(e.getAttribute('aria-label')||'').includes('选择模型'));
  const sr=send?rect(send):null,mr=model?rect(model):null,cr=composer?rect(composer):null;
  const actionScrollAncestors=[];for(let e=send?.parentElement;e&&e!==composer;e=e.parentElement)if(/auto|scroll/.test(getComputedStyle(e).overflowX))actionScrollAncestors.push({class:e.className,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth});
  const panel=all.find(e=>e.matches('[data-model-selector-panel]'))||all.find(e=>e.getAttribute('role')==='dialog'&&e.querySelector('[data-model-group]'))||all.find(e=>e.hasAttribute('data-radix-popper-content-wrapper')&&e.querySelector('[data-model-group]'));
  const rail=panel?.querySelector('[data-model-group]')?.parentElement;
  const selector=panel?{rect:rect(panel),rail:rail?rect(rail):null}:null;
  const overlap=sr&&mr?Math.max(0,Math.min(sr.right,mr.right)-Math.max(sr.x,mr.x))*Math.max(0,Math.min(sr.bottom,mr.bottom)-Math.max(sr.y,mr.y)):null;
  const navs=[...document.querySelectorAll('nav,[role="navigation"]')].filter(visible).map(e=>({label:e.getAttribute('aria-label'),rect:rect(e),text:(e.textContent||'').slice(0,240)}));
  return {viewport:{width:vw,height:vh},documentWidth:document.documentElement.scrollWidth,
   overflow:document.documentElement.scrollWidth>vw+2,offenders,
   composer:cr?{rect:cr,send:sr,model:mr,overlap,sendInBounds:!!sr&&sr.right<=vw+1&&sr.x>=0,modelInBounds:!!mr&&mr.right<=vw+1&&mr.x>=0,
    minTouchTarget:sr?Math.min(sr.width,sr.height):null,modelSendRightGap:sr?cr.right-sr.right-parseFloat(getComputedStyle(composer).borderRightWidth||0):null,actionScrollAncestors}:null,navs,selector,
   headings:[...document.querySelectorAll('h1,h2,h3')].filter(visible).map(e=>({text:e.textContent?.trim(),rect:rect(e)})).slice(0,16)};
 });
}
function evaluateGeometry(m,report,state) {
 const fail=(type,detail)=>report.findings.push({type,state,...detail});
 if(m.overflow)fail('document-overflow',{width:m.documentWidth,viewport:m.viewport.width,offenders:m.offenders});
 if(m.composer){const c=m.composer;
  if(!c.send)fail('composer-send-missing',{});
  if(!c.model)report.gaps.push({type:'composer-model-entry-missing',state});
  if(c.send&&!c.sendInBounds)fail('composer-send-outside-viewport',c);
  if(c.model&&!c.modelInBounds)fail('composer-model-outside-viewport',c);
  if(c.overlap>1)fail('composer-model-send-overlap',c);
  if(c.send&&c.modelSendRightGap>16.1)fail('composer-send-right-padding',{gap:c.modelSendRightGap,limit:16});
  if(c.actionScrollAncestors.length)fail('composer-action-in-scroll-region',{ancestors:c.actionScrollAncestors});
  if(m.viewport.width<=390&&c.minTouchTarget!==null&&c.minTouchTarget<43.9)fail('composer-send-touch-target',{size:c.minTouchTarget,minimum:44});
 }
}
module.exports={measure,evaluateGeometry};
