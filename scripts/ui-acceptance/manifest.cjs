'use strict';
// All data supplied by this harness is synthetic UI acceptance fixture data.
const scenarios = [
  ['login', '/auth/login', 'anonymous', 'login'],
  ['register', '/auth/register', 'anonymous', 'register'],
  ['welcome', '/main', 'admin', 'welcome'],
  ['session', '/main/9101', 'admin', 'session'],
  ['personal', '/main/settings/personal', 'user', 'personal'],
  ['system', '/main/settings/system', 'admin', 'system'],
  ['battle', '/main/battle', 'admin', 'battle'],
  ['battle-multi', '/main/battle/multi-model', 'admin', 'battle-multi'],
  ['logs', '/main/logs', 'admin', 'logs'],
  ['logs-system', '/main/logs/system', 'admin', 'logs-system'],
  ['trace', '/main/logs/task-trace', 'admin', 'trace'],
  ['share', '/share/ui-fixture-public', 'anonymous', 'share'],
].map(([id, path, actor, flow]) => ({ id, path, actor, flow }));
scenarios.find(s => s.id === 'share').path = '/share/ui-v2-demo';
scenarios.push(
 {id:'share-error',path:'/share/ui-v2-missing',actor:'anonymous',flow:'share-error'},
 {id:'models-empty',path:'/main',actor:'admin',flow:'welcome',variant:'models-empty'},
 {id:'models-error',path:'/main',actor:'admin',flow:'welcome',variant:'models-error'},
 {id:'models-refresh-error',path:'/main',actor:'admin',flow:'welcome',variant:'models-refresh-error'},
 {id:'models-loading',path:'/main',actor:'admin',flow:'welcome',variant:'models-loading'},
 {id:'logs-first-error',path:'/main/logs/system',actor:'admin',flow:'logs-error',variant:'logs-first-error'},
 {id:'logs-refresh-error',path:'/main/logs/system',actor:'admin',flow:'logs-system',variant:'logs-refresh-error'},
 {id:'battle-result',path:'/main/battle/multi-model',actor:'admin',flow:'battle-multi',variant:'battle-result'},
);
const viewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 358, height: 800 }, { width: 320, height: 760 }];
const dark = ['welcome', 'session', 'personal', 'system', 'share', 'battle', 'battle-result', 'models-empty', 'models-error', 'logs-refresh-error'];
module.exports = { scenarios, viewports, dark };
