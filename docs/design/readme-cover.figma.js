const page=figma.currentPage;
if(page.children.some(n=>n.name==='AI Chat / README cover')) throw new Error('README cover already exists; edit the existing frame.');
const fonts=[{family:'Source Sans 3',style:'Regular'},{family:'Source Sans 3',style:'Bold'},{family:'Microsoft YaHei',style:'Regular'},{family:'Microsoft YaHei',style:'Bold'}];
for(const f of fonts) await figma.loadFontAsync(f);
const C={bg:'#F6F6F3',ink:'#14171C',muted:'#515860',line:'#DDDED8',teal:'#0F766E',soft:'#E8F3EF',white:'#FFFFFF',pale:'#F0F1EC'};
const rgb=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const paint=h=>[{type:'SOLID',color:rgb(h)}];
function box(parent,name,x,y,w,h,fill,r=0,stroke=null){const n=figma.createFrame();n.name=name;parent.appendChild(n);n.resize(w,h);n.x=x;n.y=y;n.fills=paint(fill);n.cornerRadius=r;if(stroke){n.strokes=paint(stroke);n.strokeWeight=1;}return n;}
function text(parent,name,value,x,y,size,color=C.ink,bold=false,width=null,cjk=false){const n=figma.createText();parent.appendChild(n);n.name=name;n.fontName={family:cjk?'Microsoft YaHei':'Source Sans 3',style:bold?'Bold':'Regular'};n.fontSize=size;n.lineHeight={unit:'PERCENT',value:cjk?145:120};n.characters=value;n.fills=paint(color);if(width){n.resize(width,1);n.textAutoResize='HEIGHT';}n.x=x;n.y=y;return n;}
function line(parent,x,y,w,color=C.line){const n=figma.createRectangle();parent.appendChild(n);n.name='Divider';n.resize(w,1);n.x=x;n.y=y;n.fills=paint(color);return n;}
function dot(parent,x,y,r,color){const n=figma.createEllipse();parent.appendChild(n);n.resize(r*2,r*2);n.x=x;n.y=y;n.fills=paint(color);return n;}
const frame=box(page,'AI Chat / README cover',0,0,1600,840,C.bg);
frame.y=page.children.filter(n=>n.id!==frame.id).reduce((v,n)=>Math.max(v,n.y+n.height),0)+160;
frame.clipsContent=true;
// Identity: clean text mark; no invented corporate logo.
box(frame,'Brand accent',80,71,8,36,C.teal,4);
text(frame,'Project name','AI Chat',104,61,44,C.ink,true);
text(frame,'Category','SELF-HOSTED AI WORKSPACE',80,151,18,C.teal,true);
text(frame,'Headline','把对话，\n变成成果。',75,204,76,C.ink,true,670,true);
text(frame,'Description','多模型对话、联网研究与文件分析，\n在你自己的服务里完成。',80,459,25,C.muted,false,680,true);
const tags=box(frame,'Core capabilities',80,578,600,48,C.bg);
for(const [i,v] of ['多模型','深度研究','MCP · Skill'].entries()){const x=[0,150,320][i];if(i)dot(tags,x-24,21,2,C.muted);text(tags,'Capability '+i,v,x,7,21,C.ink,false,null,true);}
// Editable product illustration. Its sample content describes a supported workflow.
const app=box(frame,'Product illustration',796,157,724,505,C.white,16,C.line);
box(app,'Titlebar',0,0,724,55,C.white);
line(app,0,54,724);
text(app,'Workspace title','研究与分析',26,16,18,C.ink,true,null,true);
text(app,'Workspace caption','对话  /  本轮工作区',454,19,14,C.muted,false,null,true);
const q=box(app,'User request',32,84,660,57,C.pale,10);
text(q,'Request text','比较这几份资料，整理一份有来源的报告。',20,17,17,C.ink,false,null,true);
const status=box(app,'Process summary',32,163,660,45,C.soft,8);
dot(status,16,17,5,C.teal);
text(status,'Process summary text','本轮工作区  ·  已完成',35,10,16,C.teal,true,null,true);
text(status,'Process counts','来源 6  /  产物 1',490,12,14,C.teal,false,null,true);
text(app,'Answer heading','资料已整理，结论与依据一起交付。',32,234,22,C.ink,true,null,true);
text(app,'Answer detail','对照关键差异，保留原始来源，并生成可下载报告。',32,276,16,C.muted,false,null,true);
line(app,32,324,660);
const file=box(app,'Report artifact',32,347,660,100,C.bg,10);
box(file,'PDF label',18,22,52,56,C.white,6,C.line);
text(file,'PDF','PDF',27,39,18,C.teal,true);
text(file,'Report name','资料对比与分析报告.pdf',88,19,18,C.ink,true,null,true);
text(file,'Report description','研究成果  ·  可下载',88,51,14,C.muted,false,null,true);
const download=box(file,'Download action',531,30,108,40,C.ink,8);
text(download,'Download label','下载报告',19,8,15,C.white,true,null,true);
text(frame,'Illustration caption','工作流程示意',1398,683,13,C.muted,false,null,true);
line(frame,80,724,1440);
text(frame,'Footer left','OPEN SOURCE  /  MIT',80,755,17,C.muted,true);
text(frame,'Footer center','Web + Android',661,750,24,C.ink,true);
text(frame,'Footer right','Docker Compose 部署',1171,750,22,C.ink,true,null,true);
return {frameId:frame.id,pageId:page.id,name:frame.name,width:frame.width,height:frame.height};
