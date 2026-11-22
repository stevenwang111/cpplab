/** Strings for login, forced password change and the account menu. */

const zhCN = {
  'auth.login.title': '登录 CppLab',
  'auth.login.subtitle': '使用管理员分配的账号登录',
  'auth.login.username': '用户名',
  'auth.login.password': '密码',
  'auth.login.submit': '登录',
  'auth.login.submitting': '登录中…',
  'auth.login.footnote': '登录状态保存在 HttpOnly Cookie 中；本实例不开放匿名注册。',

  'auth.change.title': '修改密码',
  'auth.change.subtitle': '{username}，请先设置自己的密码再继续。',

  'auth.password.current': '当前密码',
  'auth.password.new': '新密码',
  'auth.password.confirm': '确认新密码',
  'auth.password.hint': '密码长度 10-128 个字符，空格也计入。',
  'auth.password.submit': '保存新密码',
  'auth.password.submitting': '保存中…',
  'auth.password.tooShort': '新密码至少需要 10 个字符',
  'auth.password.mismatch': '两次输入的新密码不一致',
  'auth.password.unchanged': '新密码不能与当前密码相同',
  'auth.password.dialogTitle': '修改密码',
  'auth.password.dialogSubtitle': '修改后，其他设备上的会话会立即失效。',
  'auth.password.changed': '密码已更新',

  'auth.user.logout': '退出登录',
  'auth.user.changePassword': '修改密码',
  'auth.user.signedInAs': '已登录：{name}',
  'auth.user.menu': '账号菜单',

  'auth.notice.sessionExpired': '登录状态已失效（可能已在其他设备登录），请重新登录。',
  'auth.notice.loggedOut': '已退出登录。',
  'auth.error.loginFailed': '登录失败',
  'auth.error.passwordFailed': '修改密码失败',
  'auth.ws.forbidden': '没有权限访问该运行/调试会话',
} as const;

const en: Record<keyof typeof zhCN, string> = {
  'auth.login.title': 'Sign in to CppLab',
  'auth.login.subtitle': 'Use the account provided by your administrator',
  'auth.login.username': 'Username',
  'auth.login.password': 'Password',
  'auth.login.submit': 'Sign in',
  'auth.login.submitting': 'Signing in…',
  'auth.login.footnote': 'Your session lives in an HttpOnly cookie; anonymous registration is disabled.',

  'auth.change.title': 'Change password',
  'auth.change.subtitle': '{username}, set your own password before continuing.',

  'auth.password.current': 'Current password',
  'auth.password.new': 'New password',
  'auth.password.confirm': 'Confirm new password',
  'auth.password.hint': 'Use 10-128 characters; spaces count.',
  'auth.password.submit': 'Save new password',
  'auth.password.submitting': 'Saving…',
  'auth.password.tooShort': 'The new password must be at least 10 characters',
  'auth.password.mismatch': 'The new passwords do not match',
  'auth.password.unchanged': 'The new password must differ from the current one',
  'auth.password.dialogTitle': 'Change password',
  'auth.password.dialogSubtitle': 'Other sessions are signed out immediately after the change.',
  'auth.password.changed': 'Password updated',

  'auth.user.logout': 'Sign out',
  'auth.user.changePassword': 'Change password',
  'auth.user.signedInAs': 'Signed in as {name}',
  'auth.user.menu': 'Account menu',

  'auth.notice.sessionExpired': 'Your session ended (possibly signed in on another device); please sign in again.',
  'auth.notice.loggedOut': 'You have been signed out.',
  'auth.error.loginFailed': 'Sign-in failed',
  'auth.error.passwordFailed': 'Failed to change the password',
  'auth.ws.forbidden': 'You cannot access that run or debug session',
};

export default { 'zh-CN': zhCN, en };
