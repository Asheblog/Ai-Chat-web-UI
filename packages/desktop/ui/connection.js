const bridge = window.desktopConnection
const element = (id) => document.getElementById(id)
const setup = element('setup')
const recovery = element('recovery')
const field = element('address')
const badge = element('site-badge')
const descriptions = {
  unreachable: ['暂时连不上服务器', '检查网络，确认服务器已启动，再试一次。'],
  certificate: ['无法验证服务器证书', '请检查地址，或联系服务器管理员修复 HTTPS 证书。'],
  'not-aichat': ['没有找到 AI Chat 站点', '请确认这是能在浏览器打开的 AI Chat 首页，而不是 API 地址。'],
  storage: ['无法保存服务器地址', '请确认当前用户可以写入应用数据目录，再试一次。'],
}
let attemptedAddress = ''
let previous = null

function renderToolbar(state) {
  const connected = state.mode === 'connected'
  const host = connected ? new URL(state.address).host : ''
  badge.hidden = !connected
  element('site-host').textContent = host
  badge.title = host
  element('desktop-titlebar').parentElement.querySelector('main').hidden = connected
}

function render(state) {
  renderToolbar(state)
  const checking = state.mode === 'checking'
  const invalid = state.mode === 'error' && state.kind === 'invalid'
  const showRecovery = state.mode === 'error' && !invalid
  setup.hidden = showRecovery
  recovery.hidden = !showRecovery
  if (showRecovery) {
    const certificate = state.kind === 'certificate'
    recovery.dataset.kind = state.kind
    const [heading, detail] = descriptions[state.kind]
    element('recovery-title').textContent = heading
    element('recovery-message').textContent = detail
    attemptedAddress = state.address
    element('attempted-address').textContent = attemptedAddress
    element('certificate-icon').hidden = !certificate
    element('offline-icon').hidden = certificate
    const actions = element('retry').parentElement
    if (certificate) actions.prepend(element('edit'))
    else actions.prepend(element('retry'))
    element('retry').className = certificate ? 'secondary' : 'primary'
    element('edit').className = certificate ? 'primary' : 'secondary'
    if (previous?.kind !== state.kind || previous?.mode !== state.mode) element('recovery-title').focus()
  } else {
    if (previous?.mode !== state.mode || invalid) field.value = state.address
    field.readOnly = checking
    field.setAttribute('aria-invalid', String(invalid))
    field.setAttribute('aria-describedby', invalid ? 'address-error' : checking ? 'checking-hint' : 'address-hint')
    element('address-hint').hidden = invalid || checking
    element('address-error').hidden = !invalid
    element('address-error').textContent = invalid ? '请填写站点首页地址，移除路径、查询参数或末尾的 /api。' : ''
    element('checking-hint').hidden = !checking
    element('connect').disabled = checking
    element('connect-label').textContent = checking ? '连接中…' : '连接服务器'
    element('spin').hidden = !checking
    element('arrow').hidden = checking
    if ((state.mode === 'form' && previous?.mode !== 'form') || invalid) field.focus()
  }
  previous = state
}

element('connect-form').addEventListener('submit', (event) => {
  event.preventDefault()
  void bridge.connect(field.value)
})
element('retry').addEventListener('click', () => { void bridge.connect(attemptedAddress) })
element('edit').addEventListener('click', () => { void bridge.edit() })
element('guide').addEventListener('click', () => { void bridge.openGuide() })
element('titlebar-more').addEventListener('click', (event) => {
  const { right } = event.currentTarget.getBoundingClientRect()
  void bridge.openMenu({ right: Math.round(right), compact: getComputedStyle(badge).display === 'none' })
})
bridge.onState(render)
bridge.onMenuState((open) => { element('titlebar-more').setAttribute('aria-expanded', String(open)) })
void bridge.shellInfo().then(({ platform }) => { document.documentElement.dataset.platform = platform })
void bridge.getState().then(render)
