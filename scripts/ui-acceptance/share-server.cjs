'use strict';
// Explicit localhost-only SSR fixture. The lead owns its process lifecycle.
const http = require('node:http');
const {share,messages} = require('./fixtures.cjs');
const TOKEN = 'ui-v2-demo';
function respond(req,res) {
 const url = new URL(req.url,'http://127.0.0.1:18001');
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('X-UI-Acceptance-Fixture','true');
 res.setHeader('Cache-Control','no-store');
 if(req.method==='GET' && url.pathname==='/api/shares/'+TOKEN) {
  res.end(JSON.stringify({success:true,data:{...share,token:TOKEN,messages:url.searchParams.get('includeMessages')==='0'?[]:messages}}));return;
 }
 if(req.method==='GET' && url.pathname==='/api/shares/'+TOKEN+'/messages') {
  const page=Math.max(1,Number(url.searchParams.get('page'))||1);
  const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||50));
  res.end(JSON.stringify({success:true,data:{token:TOKEN,sessionId:9101,messages:messages.slice((page-1)*limit,page*limit),pagination:{page,limit,total:messages.length,totalPages:Math.ceil(messages.length/limit)}}}));return;
 }
 res.statusCode=404;res.end(JSON.stringify({success:false,error:'UI fixture endpoint not found'}));
}
if(require.main===module) http.createServer(respond).listen(18001,'127.0.0.1',()=>console.log('UI fixture SSR listening on http://127.0.0.1:18001; only /api/shares/ui-v2-demo[/messages]'));
module.exports = {respond};
