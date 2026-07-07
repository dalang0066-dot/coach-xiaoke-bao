var app = getApp()
var U = require('../../utils/util.js')
var C = require('../../utils/cloud.js')
var A = require('../../utils/analytics.js')
var S = require('../../utils/schedule.js')
var Sync = require('../../utils/sync.js')
var MR = require('../../utils/monthlyReportAssets.js')
var AVATARS = []
var SWIPE_ACTION_WIDTH = 552
var FREE_STUDENT_LIMIT = 20
var MONTHLY_REPORT_BG = '/images/monthly-report-bg.jpg'
var MONTHLY_REPORT_W = 1842
var MONTHLY_REPORT_H = 2304
for (var ai = 1; ai <= 40; ai++) { AVATARS.push('/images/avatars/avatar_' + ai + '.png') }
function rem(exclude) {
  var pool = exclude ? AVATARS.filter(function (a) { return a !== exclude }) : AVATARS
  return pool[Math.floor(Math.random() * pool.length)]
}
function syncStudentSafe(student) {
  Sync.syncStudentSafe(student)
}

function syncScheduleSafe(schedule) {
  Sync.syncScheduleSafe(schedule)
}

function buildScheduleDisplayChips(meta) {
  var raw = (meta && meta.chips) ? meta.chips : []
  var chips = []
  for (var i = 0; i < raw.length && chips.length < 3; i++) {
    chips.push({
      id: raw[i].id,
      label: raw[i].label,
      tone: raw[i].overdue ? 'red' : 'green',
      icon: raw[i].overdue ? 'clock' : 'calendar',
      empty: false
    })
  }
  if (!chips.length) {
    chips.push({ id: 'empty', label: '暂无排课', tone: 'gray', icon: 'calendar', empty: true })
  } else if (chips.length < 3) {
    chips.push({ id: 'empty-' + chips.length, label: '暂无排课', tone: 'gray', icon: 'calendar', empty: true })
  }
  while (chips.length < 3) {
    chips.push({ id: 'blank-' + chips.length, label: '', tone: 'blank', icon: 'none', empty: true, blank: true })
  }
  return chips
}

function formatClassScheduleTime(schedule) {
  if (!schedule || !schedule.date) return ''
  var parts = (schedule.date || '').split('-')
  var month = parseInt(parts[1]) || 0
  var day = parseInt(parts[2]) || 0
  var dateText = (month ? month : parts[1]) + '月' + (day ? day : parts[2]) + '日'
  return dateText + ' ' + S.formatHM(schedule.startTime)
}

function formatCurrentClassTime(date) {
  var d = date || new Date()
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + U.p2(d.getHours()) + ':' + U.p2(d.getMinutes())
}

function p2Local(n) { return (n < 10 ? '0' : '') + n }

function prevMonthInfo(today) {
  var d = S.toDate(today)
  var first = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  var last = new Date(d.getFullYear(), d.getMonth(), 0)
  var y = first.getFullYear()
  var m = first.getMonth() + 1
  return {
    year: y,
    month: m,
    key: y + '-' + p2Local(m),
    start: y + '-' + p2Local(m) + '-01',
    end: last.getFullYear() + '-' + p2Local(last.getMonth() + 1) + '-' + p2Local(last.getDate()),
    title: m + '月上课汇总',
    monthText: y + '年' + m + '月'
  }
}

function reportQuoteKey(total) {
  if (total < 30) return 'low'
  if (total <= 100) return 'mid'
  return 'high'
}

function reportQuote(total) {
  var key = reportQuoteKey(total)
  if (key === 'low') return '这个月稳稳开局，每一节课都在攒口碑'
  if (key === 'mid') return '这个月带课节奏很稳，继续保持'
  return '这个月火力全开，课表密度拉满'
}

function reportStudentRefs(students) {
  var refs = { byId: {}, byUid: {}, byCloud: {} }
  for (var i = 0; i < (students || []).length; i++) {
    var st = students[i]
    if (!st || st.deleted) continue
    refs.byId[st.id] = st
    if (st.studentUid) refs.byUid[st.studentUid] = st
    if (st._cloudId) refs.byCloud[st._cloudId] = st
  }
  return refs
}

function reportStudentForSchedule(s, refs) {
  if (!s || !refs) return null
  if (s.studentUid && refs.byUid[s.studentUid]) return refs.byUid[s.studentUid]
  if (s.studentCloudId && refs.byCloud[s.studentCloudId]) return refs.byCloud[s.studentCloudId]
  var st = refs.byId[s.studentId]
  if (!st) return null
  if (s.studentName && st.name && s.studentName !== st.name) return null
  return st
}

function reportScheduleKey(s) {
  if (!s) return ''
  if (s.scheduleUid) return 'uid:' + s.scheduleUid
  if (s.localKey) return 'local:' + s.localKey
  if (s._cloudId) return 'cloud:' + s._cloudId
  if (s.linkedHistoryTs) return 'hist:' + s.linkedHistoryTs
  var composite = [
    s.studentUid || s.studentCloudId || s.studentId || '',
    s.studentName || '',
    s.date || '',
    s.startTime || '',
    S.formatAmount(S.actualAmount(s)),
    s.type || '',
    s.status || ''
  ].join('|')
  return composite || ('id:' + (s.id || ''))
}

function canvasSetFont(ctx, size, weight) {
  if ('font' in ctx) ctx.font = (weight || 'normal') + ' ' + size + 'px sans-serif'
  ctx.setFontSize(size)
}

function canvasMeasure(ctx, text, size) {
  if (ctx.measureText) {
    var m = ctx.measureText(String(text || ''))
    if (m && m.width) return m.width
  }
  return String(text || '').length * size * 0.56
}

function canvasFillBoldText(ctx, text, x, y, strength) {
  strength = strength || 1
  for (var ox = -strength; ox <= strength; ox++) {
    for (var oy = -strength; oy <= strength; oy++) {
      if (Math.abs(ox) + Math.abs(oy) > strength + 1) continue
      ctx.fillText(text, x + ox, y + oy)
    }
  }
}

function canvasWrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines, size, boldStrength) {
  var chars = String(text || '').split('')
  var line = ''
  var lines = []
  for (var i = 0; i < chars.length; i++) {
    var next = line + chars[i]
    if (canvasMeasure(ctx, next, size) > maxWidth && line) {
      lines.push(line)
      line = chars[i]
      if (lines.length >= maxLines) break
    } else {
      line = next
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  for (var j = 0; j < lines.length; j++) {
    if (boldStrength) canvasFillBoldText(ctx, lines[j], x, y + j * lineHeight, boldStrength)
    else ctx.fillText(lines[j], x, y + j * lineHeight)
  }
}

function drawReportAsset(ctx, asset, x, y, w, h) {
  if (!asset || !asset.file) return { x: x, w: 0, h: 0 }
  w = w || asset.w
  h = h || asset.h
  ctx.drawImage(MR.base + asset.file, x, y, w, h)
  return { x: x + w, w: w, h: h }
}

function drawReportText(ctx, styleName, text, x, y, gap, scaleX, scaleY) {
  var map = MR[styleName] || {}
  var pos = x
  scaleX = scaleX || 1
  scaleY = scaleY || 1
  var chars = String(text || '').split('')
  for (var i = 0; i < chars.length; i++) {
    var asset = map[chars[i]]
    if (!asset) continue
    var w = Math.round(asset.w * scaleX)
    var h = Math.round(asset.h * scaleY)
    ctx.drawImage(MR.base + asset.file, pos, y, w, h)
    pos += w + (gap || 0)
  }
  return pos - (gap || 0)
}

Page({
  data: {
    sbh: 20, empty: true, students: [], list: [], keyword: '',
    showSleepy: false, sleepyName: '', showSwipeBanner: false,
    showExpiry: false, expiryName: '', expiryDay: 0,
    showMember: false,
    showClass: false, classTarget: {}, classAmount: 1, classCustom: '', classCustomSelected: false, classSchedule: null, classRestoreScheduleOnUndo: false, classScheduleAmountText: '', classScheduleTimeText: '', classConfirmTimeText: '', classScheduleState: '', classTitle: '选择消课节数', classExtraAmount: 0, classLessAmount: 0, classSubmitting: false,
    showMultiOverdue: false, multiOverdueStudent: {}, multiOverdueList: [],
    showStudentSchedules: false, studentScheduleTarget: {}, studentScheduleList: [],
    showScheduleDel: false, scheduleDelTarget: {},
    showScheduleEdit: false, scheduleEditSource: '', scheduleEditForm: {}, scheduleEditAmountLimit: 0, scheduleEditAmountShake: false, scheduleEditNoteCount: 0, scheduleEditSaving: false,
    scheduleEditY: 0, scheduleEditMaskOpacity: 1, scheduleEditTransition: 'transform 240ms cubic-bezier(.2,.8,.2,1)', scheduleEditBodyScrollEnabled: true,
    showScheduleEditConfirm: false, scheduleEditConfirmTitle: '', scheduleEditConfirmDesc: '', scheduleEditConfirmOkText: '确定', scheduleEditConfirmDanger: false,
    showForm: false, editing: false, editId: 0, nameFocus: false,
    fd: { avatarSrc: '/images/avatars/avatar_1.png', name: '', totalLessons: 24, expiryDate: '', note: '' },
    showDel: false, delTarget: {},
    showHist: false, histData: { name: '', remaining: 0, emoji: '🐯', records: [] },
    showExpModal: false,
    showUpg: false, upgradeTitle: '升级专业版', plan: U.PLAN.MONTHLY, paying: false,
    showUndo: false, lastUndo: null,
    showLowT: false, lowMsg: '',
    showOkT: false, okMsg: '操作成功', showHintT: false,
    showEasterT: false, showEasterEgg: false, easterClaimed: false, confetti: [],
    showFeedback: false, fbContent: '', fbContact: '', fbImgs: [], feedbackSubmitting: false,
    showFbPreview: false, fbPreviewSrc: '',
    fbShowMember: false, showShareModal: false, _polling: false,
    showRewardModal: false, rewardTitle: '', rewardSub: '', rewardDays: 0, rewardType: '',
    showMonthlyReport: false, monthlyReportImg: '', monthlyReportData: { title: '上月上课汇总' }, monthlyReportGenerating: false,
    isPro: false, proExpiry: '', proExpSoon: false, activeCnt: 0, scrollTop: 0, kbH: 0, scrollY: true, refreshing: false, botPad: 20, listHasOverflow: false,
    scheduleBadge: { count: 0, tone: '' }, scheduleFabStyle: '',
    showDebug: false, debugOffset: 0, debugExpDays: 0, debugMember: 0, debugTodayText: '', debugReportMonthText: '',
    showDebugClearConfirm: false,
    icoTop: 0, icoLeft: 0, icoSize: 32, icoRadius: 16,
    _tsX: 0, _tsY: 0, _openIx: -1, _swipeIx: -1, _locked: false
  },

  _searchTimer: null,
  _guideTapCount: 0,
  _guideTapTimer: null,

  onShareAppMessage: function () {
    var ref = app.globalData._realOpenid || ''
    if (ref) this.data._justShared = true
    return {
      title: '教练消课宝——独立教练的消课管理工具',
      path: '/pages/index/index' + (ref ? '?ref=' + ref : ''),
      imageUrl: '/images/bg.jpg'
    }
  },

  onLoad: function () {
    var sys = wx.getSystemInfoSync()
    var safeBot = sys.safeArea ? (sys.screenHeight - sys.safeArea.bottom) : 0
    var botPad = safeBot > 0 ? Math.round(safeBot * 750 / sys.screenWidth) : 40
    var menuBtn = wx.getMenuButtonBoundingClientRect()
    var icoW = Math.round(menuBtn.height * 750 / sys.screenWidth)
    var icoR = Math.round(icoW / 2)
    this.setData({
      sbh: app.globalData.statusBarHeight || sys.statusBarHeight || 20,
      botPad: botPad,
      icoTop: Math.round(menuBtn.top * 750 / sys.screenWidth),
      icoLeft: Math.round((menuBtn.left - menuBtn.height - 10) * 750 / sys.screenWidth),
      icoSize: icoW,
      icoRadius: icoR
    })
    var that = this
    this._scheduleFabBasePx = Math.round(156 * sys.screenWidth / 750)
    wx.onKeyboardHeightChange(function (res) {
      that.setData({
        kbH: res.height,
        scheduleFabStyle: res.height > 0 ? ('bottom:' + (res.height + that._scheduleFabBasePx) + 'px') : ''
      })
    })
    this.reload()
  },

  onShow: function () {
    var that = this
    C.checkNetwork()
    // 修复底部栏悬空：切前台时重置键盘高度
    if (this.data.kbH > 0) this.setData({ kbH: 0, scheduleFabStyle: '' })
    // 分享后切回来：自动关闭分享弹窗 + 启动轮询
    if (this.data.showShareModal) this.closeShareModal()
    if (this.data._justShared) { this.data._justShared = false; this.startSharePoll() }
    this.processPendingReferral()
    if (C.isOnline()) {
      C.flushQueue()
      if (app.syncCloudQuietly) app.syncCloudQuietly(false)
      if (app.startRealtimeSync) app.startRealtimeSync()
      // 补上离线时未同步的彩蛋标记
      if (wx.getStorageSync('_pending_easter_sync') && C.isReady() && app.globalData._realOpenid) {
        app.save()
        C.syncEasterClaimed()
        wx.removeStorageSync('_pending_easter_sync')
      }
    }
    this.reload()
    // 后台查分享奖励，有就弹窗
    var rewardPullNow = Date.now()
    if (C.isReady() && (!app.globalData._lastRewardPullAt || rewardPullNow - app.globalData._lastRewardPullAt > 300000 || app.globalData._pendingRef)) {
      app.globalData._lastRewardPullAt = rewardPullNow
      C.pullMember(function (isPro, expired, proExp, welcomeDays, pendingDays) {
        if (welcomeDays > 0) {
          app.globalData.isProMember = !!isPro
          app.globalData.memberExpired = !!expired
          app.globalData.proExpiry = proExp || ''
          C.clearRewardFlags()
          app.globalData.upgradeShown = true; app.save()
          that.setData({ showRewardModal: true, rewardTitle: '恭喜你！', rewardDays: welcomeDays, rewardType: 'welcome', isPro: true, proExpiry: proExp || '' })
        } else if (pendingDays > 0) {
          app.globalData.isProMember = !!isPro
          app.globalData.memberExpired = !!expired
          app.globalData.proExpiry = proExp || ''
          C.clearRewardFlags()
          app.globalData.upgradeShown = true; app.save()
          that.setData({ showRewardModal: true, rewardTitle: '恭喜你！', rewardDays: pendingDays, rewardType: 'share', isPro: true, proExpiry: proExp || '' })
        }
      })
    }
  },


  processPendingReferral: function () {
    var that = this
    var refId = ''
    if (app.globalData._pendingRef) {
      refId = app.globalData._pendingRef
    } else {
      var enterOpts = wx.getEnterOptionsSync()
      if (enterOpts.query && enterOpts.query.ref) refId = enterOpts.query.ref
    }
    if (!refId) return
    if (!C.isReady()) {
      app.globalData._pendingRef = refId
      return
    }
    if (app.globalData._refProcessing) return
    app.globalData._pendingRef = ''
    app.globalData._refProcessing = true
    C.processReferral(refId, function (e, res) {
      app.globalData._refProcessing = false
      if (!e) {
        app.globalData.isProMember = true
        app.globalData.memberExpired = false
        app.globalData.upgradeShown = true
        var exp = (res && res.expiry) ? res.expiry : ''
        if (!exp) {
          var fd = new Date()
          fd.setDate(fd.getDate() + 15)
          exp = fd.getFullYear() + '-' + U.p2(fd.getMonth() + 1) + '-' + U.p2(fd.getDate())
        }
        app.globalData.proExpiry = exp
        app.save()
        C.clearRewardFlags()
        that.setData({
          showRewardModal: true,
          rewardTitle: '恭喜你！',
          rewardDays: 15,
          rewardType: 'welcome',
          isPro: true,
          proExpiry: exp
        })
      }
    })
  },
  onHide: function () {
    if (app.stopRealtimeSync) app.stopRealtimeSync()
    this.clearPageTimers()
    this.setData({ showUndo: false, lastUndo: null, showLowT: false, lowMsg: '', showOkT: false, showEasterT: false, refreshing: false, scrollY: true })
  },

  onUnload: function () {
    if (app.stopRealtimeSync) app.stopRealtimeSync()
    this.clearPageTimers()
  },

  reload: function () {
    var ss = app.globalData.students || []
    var pro = app.globalData.isProMember && !app.globalData.memberExpired
    // 检查Pro到期：如果到期日已过，自动标记过期
    if (app.globalData.proExpiry && U.today() > app.globalData.proExpiry) {
      app.globalData.memberExpired = true
      app.globalData.proExpiry = ''
      app.save()
      pro = false
    }
    var bd = app.globalData.bannerDismissedToday || {}
    var td = this.debugTD()
    var nowTs = Date.now()
    var scheduleMeta = S.buildAllStudentMeta(app.globalData.schedules || [], ss, td, nowTs)
    var scheduleBadge = S.summarizeBadge(app.globalData.schedules || [], ss, U.today(), nowTs)

    // 单次遍历：检测沉睡、到期、计数、构建list
    var sl = false, sn = '', ex = false, en = '', ed = 0, ac = 0
    var r = []
    for (var i = 0; i < ss.length; i++) {
      var s = ss[i]
      if (s.deleted) continue
      ac++
      if (!sl && !U.isExp(s) && s.lastClassDate && U.daysBetween(s.lastClassDate, td) >= 30) {
        sl = true; sn = s.name
      }
      if (!ex && s.expiryDate && !U.isExp(s) && s.remainingLessons > 0) {
        var dd = U.daysBetween(td, s.expiryDate)
        if (dd === 7 || dd === 1) { ex = true; en = s.name; ed = dd }
      }
      var sm = scheduleMeta[s.id] || { chips: [], overdueCount: 0, todayCount: 0, earliestOverdueTs: 0, todayTs: 0, nextTs: 0, statusText: '', statusTone: '' }
      var scheduleChips = buildScheduleDisplayChips(sm)
      var hasSchedule = sm.chips && sm.chips.length > 0
      var exp = U.isExp(s)
      var zeroLessons = S.parseAmount(s.remainingLessons, 0) <= 0
      var item = {
        id: s.id, name: s.name, avatarSrc: s.avatarSrc || '/images/avatars/avatar_1.png',
        note: s.note || '', remainingLessons: s.remainingLessons,
        expiryDate: s.expiryDate, lastClassDate: s.lastClassDate,
        lastModified: s.lastModified || 0, exp: exp, zeroLessons: zeroLessons, inactive: exp || zeroLessons, low: !exp && !zeroLessons && s.remainingLessons <= 3,
        scheduleChips: sm.chips,
        scheduleDisplayChips: scheduleChips,
        scheduleHasActive: hasSchedule,
        scheduleTone: sm.overdueCount > 0 ? 'red' : ((exp || zeroLessons) ? 'gray' : (hasSchedule ? 'green' : 'gray')),
        scheduleOverdueCount: sm.overdueCount,
        scheduleStatusText: sm.statusText || '',
        scheduleStatusTone: sm.statusTone || '',
        scheduleTodayCount: sm.todayCount,
        scheduleOverdueTs: sm.earliestOverdueTs || 0,
        scheduleTodayTs: sm.todayTs || 0,
        scheduleNextTs: sm.nextTs || 0,
        open: false
      }
      r.push(item)
    }
    if (bd.sleepy) sl = false
    if (bd.expiry) ex = false
    var mb = app.globalData.memberExpired && !pro
    if (bd.memberExpired) mb = false

    var kw = (this.data.keyword || '').trim().toLowerCase()
    if (kw) { r = r.filter(function (x) { return x.name.toLowerCase().indexOf(kw) !== -1 }) }
    r.sort(function (a, b) {
      var ao = a.scheduleOverdueCount > 0
      var bo = b.scheduleOverdueCount > 0
      if (ao !== bo) return ao ? -1 : 1
      if (ao && bo) return (a.scheduleOverdueTs || 9999999999999) - (b.scheduleOverdueTs || 9999999999999)
      var ai = a.inactive && !a.scheduleOverdueCount
      var bi = b.inactive && !b.scheduleOverdueCount
      if (ai !== bi) return ai ? 1 : -1
      if (a.scheduleTodayCount !== b.scheduleTodayCount) return b.scheduleTodayCount - a.scheduleTodayCount
      if (a.scheduleTodayTs || b.scheduleTodayTs) return (a.scheduleTodayTs || 9999999999999) - (b.scheduleTodayTs || 9999999999999)
      if (a.scheduleNextTs || b.scheduleNextTs) return (a.scheduleNextTs || 9999999999999) - (b.scheduleNextTs || 9999999999999)
      return (b.lastModified || 0) - (a.lastModified || 0)
    })

    if (mb) {
      sl = false; ex = false
    } else if (ex) {
      sl = false
    }
    var showSwipeBanner = ac > 0 && !app.globalData.swipeHintDismissed && !mb && !ex && !sl
    var expSoon = pro && app.globalData.proExpiry && U.daysBetween(td, app.globalData.proExpiry) <= 7
    var that = this
    this.setData({
      students: ss.slice(), isPro: pro, proExpiry: app.globalData.proExpiry || '', proExpSoon: expSoon,
      showSleepy: sl, sleepyName: sn,
      showSwipeBanner: showSwipeBanner,
      showExpiry: ex, expiryName: en, expiryDay: ed,
      showMember: mb,
      activeCnt: ac, empty: ac === 0,
      scheduleBadge: scheduleBadge,
      list: r.slice(), _openIx: -1
    }, function () {
      that.measureListOverflow()
      that.scheduleStatusRefresh()
      that.queueMonthlyReportCheck()
    })
    // 分享奖励弹窗
    if (app.globalData.welcomeReward > 0) {
      var d = app.globalData.welcomeReward
      app.globalData.welcomeReward = 0
      app.globalData.upgradeShown = true; app.save()
      this.setData({ showRewardModal: true, rewardTitle: '恭喜你！', rewardDays: d, rewardType: 'welcome', isPro: true, proExpiry: app.globalData.proExpiry || '' })
      if (C.isReady()) C.clearRewardFlags()
    } else if (app.globalData.pendingReward > 0) {
      var days = app.globalData.pendingReward
      app.globalData.pendingReward = 0
      app.globalData.upgradeShown = true; app.save()
      this.setData({ showRewardModal: true, rewardTitle: '恭喜你！', rewardDays: days, rewardType: 'share', isPro: true, proExpiry: app.globalData.proExpiry || '' })
      if (C.isReady()) C.clearRewardFlags()
    }
  },

  clearStatusRefreshTimer: function () {
    if (this._statusRefreshTimer) {
      clearTimeout(this._statusRefreshTimer)
      this._statusRefreshTimer = null
    }
  },

  scheduleStatusRefresh: function () {
    var schedules = app.globalData.schedules || []
    var next = S.nextRefreshTs(schedules, Date.now())
    if (!next) return
    var delay = Math.max(1000, next - Date.now() + 300)
    if (delay > 3600000) delay = 3600000
    var that = this
    this.clearStatusRefreshTimer()
    this._statusRefreshTimer = setTimeout(function () {
      that._statusRefreshTimer = null
      that.reload()
    }, delay)
  },

  queueMonthlyReportCheck: function () {
    var that = this
    if (this._monthlyReportTimer) clearTimeout(this._monthlyReportTimer)
    this._monthlyReportTimer = setTimeout(function () {
      that._monthlyReportTimer = null
      that.maybeShowMonthlyReport()
    }, 500)
  },

  hasBlockingMonthlyReportModal: function () {
    var d = this.data
    return !!(
      d.showSleepy || d.showExpiry || d.showMember || d.showClass ||
      d.showMultiOverdue || d.showStudentSchedules || d.showScheduleDel ||
      d.showScheduleEdit || d.showScheduleEditConfirm || d.showForm ||
      d.showDel || d.showHist || d.showExpModal || d.showUpg ||
      d.showEasterEgg || d.showFeedback || d.showFbPreview ||
      d.showShareModal || d.showRewardModal || d.showDebug ||
      d.showDebugClearConfirm
    )
  },

  maybeShowMonthlyReport: function () {
    if (this._monthlyReportChecking || this.data.showMonthlyReport || this.data.monthlyReportGenerating) return
    var today = this.debugTD()
    var now = S.toDate(today)
    var day = now.getDate()
    if (day < 1 || day > 3) return
    var info = prevMonthInfo(today)
    var seenKey = 'monthly_report_seen_' + info.key
    if (wx.getStorageSync(seenKey)) return
    if (this.hasBlockingMonthlyReportModal()) {
      if (this._monthlyReportRetryTimer) return
      var thatRetry = this
      this._monthlyReportRetryTimer = setTimeout(function () {
        thatRetry._monthlyReportRetryTimer = null
        thatRetry.maybeShowMonthlyReport()
      }, 2500)
      return
    }
    var report = this.buildMonthlyReportData(info)
    if (!report || report.totalLessonsRaw <= 0) return
    var that = this
    this._monthlyReportChecking = true
    this.setData({ monthlyReportGenerating: true, monthlyReportData: report, monthlyReportImg: '' }, function () {
      that.drawMonthlyReport(report, function (path) {
        that._monthlyReportChecking = false
        if (!path) {
          that.setData({ monthlyReportGenerating: false })
          return
        }
        wx.setStorageSync(seenKey, true)
        that.setData({ showMonthlyReport: true, monthlyReportImg: path, monthlyReportGenerating: false })
      })
    })
  },

  buildMonthlyReportData: function (info) {
    var schedules = app.globalData.schedules || []
    var students = app.globalData.students || []
    var refs = reportStudentRefs(students)
    var seen = {}
    var studentSeen = {}
    var daySeen = {}
    var total = 0
    var classes = 0
    for (var i = 0; i < schedules.length; i++) {
      var s = schedules[i]
      if (!s || S.isHidden(s) || s.status !== S.STATUS.COMPLETED) continue
      var stu = reportStudentForSchedule(s, refs)
      if (!stu) continue
      var date = s.date || ''
      if (!date && s.completedAt) date = S.fromDate(new Date(s.completedAt))
      if (!date || date < info.start || date > info.end) continue
      var key = reportScheduleKey(s)
      if (seen[key]) continue
      seen[key] = true
      var amount = S.actualAmount(s)
      if (amount <= 0) continue
      total = Math.round((total + amount) * 10) / 10
      classes++
      daySeen[date] = true
      studentSeen[stu.studentUid || stu._cloudId || stu.id || s.studentId || s.studentName] = true
    }
    return {
      title: info.title,
      month: info.month,
      monthText: info.monthText,
      totalLessonsRaw: total,
      totalLessons: String(Math.ceil(total)),
      studentCount: Object.keys(studentSeen).length,
      classCount: classes,
      activeDays: Object.keys(daySeen).length,
      quoteKey: reportQuoteKey(total),
      quote: reportQuote(total)
    }
  },

  drawMonthlyReport: function (report, done) {
    var that = this
    var ctx = wx.createCanvasContext('monthlyReportCanvas', this)
    ctx.drawImage(MONTHLY_REPORT_BG, 0, 0, MONTHLY_REPORT_W, MONTHLY_REPORT_H)
    if (ctx.setTextBaseline) ctx.setTextBaseline('top')

    var titleAsset = MR.title[p2Local(report.month || 1)]
    drawReportAsset(ctx, titleAsset, 52, -50, titleAsset.w, Math.round(titleAsset.h * 1.22))
    drawReportText(ctx, 'month', report.monthText, 70, 350, -12)

    var totalText = report.totalLessons || '0'
    var totalY = 515
    var totalScaleY = 1.3
    var totalRight = drawReportText(ctx, 'total', totalText, 55, totalY, -22, 1, totalScaleY)
    var totalUnit = MR.totalUnit['节']
    drawReportAsset(ctx, totalUnit, totalRight + 26, totalY + Math.round(MR.total['0'].h * totalScaleY) - totalUnit.h)

    var smallScale = 1.52
    var smallUnitScale = 1.36
    var smallDigitH = Math.round(MR.small['0'].h * smallScale)
    var drawSmallStat = function (text, unitText, y) {
      var right = drawReportText(ctx, 'small', String(text || 0), 286, y, -9, smallScale, smallScale)
      var unitAsset = MR.smallUnit[unitText]
      var unitW = Math.round(unitAsset.w * smallUnitScale)
      var unitH = Math.round(unitAsset.h * smallUnitScale)
      drawReportAsset(ctx, unitAsset, right + 10, y + smallDigitH - unitH, unitW, unitH)
    }
    drawSmallStat(report.studentCount, '人', 1058)
    drawSmallStat(report.classCount, '次', 1303)
    drawSmallStat(report.activeDays, '天', 1550)

    var quoteAsset = MR.quote[report.quoteKey || 'mid']
    drawReportAsset(ctx, quoteAsset, 104, 1948)

    ctx.draw(false, function () {
      wx.canvasToTempFilePath({
        canvasId: 'monthlyReportCanvas',
        width: MONTHLY_REPORT_W,
        height: MONTHLY_REPORT_H,
        destWidth: MONTHLY_REPORT_W,
        destHeight: MONTHLY_REPORT_H,
        fileType: 'jpg',
        quality: 0.98,
        success: function (res) { done(res.tempFilePath) },
        fail: function () { done('') }
      }, that)
    })
  },

  getById: function (id) {
    var ss = app.globalData.students || []
    var deletedMatch = null
    for (var i = 0; i < ss.length; i++) {
      if (ss[i].id == id) {
        if (!ss[i].deleted) return ss[i]
        if (!deletedMatch) deletedMatch = ss[i]
      }
    }
    return deletedMatch
  },

  onSearch: function (e) {
    this.closeAll()
    var that = this
    this.setData({ keyword: e.detail.value })
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(function () { that.reload() }, 250)
  },

  onSearchFocus: function () { this.closeAll() },

  onSearchBlur: function () {},
  onSearchClear: function () { this.setData({ keyword: '' }); this.reload() },

  onRefreshStudents: function () {
    if (this.data.refreshing) return
    var that = this
    var finished = false
    var finish = function () {
      if (finished) return
      finished = true
      if (that._refreshTimer) {
        clearTimeout(that._refreshTimer)
        that._refreshTimer = null
      }
      if (that._refreshWaitTimer) {
        clearTimeout(that._refreshWaitTimer)
        that._refreshWaitTimer = null
      }
      that.reload()
      that.setData({ refreshing: false, scrollY: true })
      that.showOkText('已刷新~')
    }
    this.closeAll()
    if (this.data.kbH > 0) this.setData({ kbH: 0, scheduleFabStyle: '' })
    this.setData({ refreshing: true, scrollY: true })
    this._refreshTimer = setTimeout(finish, 8000)
    var runSync = function () {
      if (app.syncCloudQuietly) {
        app.syncCloudQuietly(true, finish)
      } else {
        finish()
      }
    }
    var waitCloud = function () {
      if (!app.globalData || !app.globalData._cloudPulling) {
        runSync()
        return
      }
      that._refreshWaitTimer = setTimeout(waitCloud, 200)
    }
    try {
      waitCloud()
    } catch (err) {
      finish()
    }
  },

  goSchedule: function () {
    this.closeAll()
    wx.navigateTo({ url: '/pages/schedule/schedule' })
  },


  // ===== 左滑 =====
  ts: function (e) {
    this.data._tsX = e.touches[0].clientX
    this.data._tsY = e.touches[0].clientY
    this.data._locked = false
    var ix = parseInt(e.currentTarget.dataset.ix)
    var openIx = this.data._openIx
    if (openIx !== -1 && openIx !== ix) {
      var list = this.data.list
      if (list[openIx]) {
        list[openIx].open = false
        list[openIx]._sx = 0
        list[openIx]._st = true
        this.data._openIx = -1
        this.setData({ list: list, _openIx: -1 })
      }
    }
  },

  tm: function (e) {
    var dx = e.touches[0].clientX - this.data._tsX
    var dy = e.touches[0].clientY - this.data._tsY
    if (this.data._locked) {
      var ix = this.data._swipeIx
      var list = this.data.list
      if (!list[ix]) return
      var cur = list[ix]._sx || 0, nx = cur + dx
      if (nx > 0) nx = 0; if (nx < -SWIPE_ACTION_WIDTH) nx = -SWIPE_ACTION_WIDTH
      list[ix]._sx = nx; list[ix]._st = false
      this.setData({ list: list, scrollY: false })
      this.data._tsX = e.touches[0].clientX
    } else if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      this.data._locked = true
      var nextIx = parseInt(e.currentTarget.dataset.ix)
      this.data._swipeIx = nextIx
      var data = { scrollY: false }
      if (this.data._openIx !== -1 && this.data._openIx !== nextIx) {
        var closeIx = this.data._openIx
        var cards = this.data.list
        if (cards[closeIx]) {
          cards[closeIx].open = false
          cards[closeIx]._sx = 0
          cards[closeIx]._st = true
          data.list = cards
          data._openIx = -1
        }
      }
      this.setData(data)
    }
  },

  te: function (e) {
    var ix = this.data._swipeIx
    var list = this.data.list
    if (this.data._locked && ix >= 0 && list[ix]) {
      var sx = list[ix]._sx || 0
      if (sx < -120) {
        if (this.data._openIx !== -1 && this.data._openIx !== ix) { this.closeIt(this.data._openIx) }
        this.openIt(ix)
      } else {
        this.closeIt(ix)
      }
    }
    this.data._locked = false
    this.data._swipeIx = -1
    this.setData({ scrollY: true })
  },
  tc: function () {
    var ix = this.data._swipeIx
    var list = this.data.list
    var data = { scrollY: true }
    if (this.data._locked && ix >= 0 && list[ix] && !list[ix].open) {
      list[ix]._sx = 0
      list[ix]._st = true
      data.list = list
    }
    this.data._locked = false
    this.data._swipeIx = -1
    this.setData(data)
  },
  openIt: function (ix) { var list = this.data.list; if (!list[ix]) return; list[ix].open = true; list[ix]._sx = 0; list[ix]._st = true; this.setData({ list: list, _openIx: ix }) },
  closeIt: function (ix) { var list = this.data.list; if (ix < 0 || !list[ix]) return; list[ix].open = false; list[ix]._sx = 0; list[ix]._st = true; this.setData({ list: list, _openIx: -1 }) },
  closeAll: function () { var l = this.data.list, i = this.data._openIx; if (i >= 0 && l[i]) { l[i].open = false; l[i]._sx = 0; l[i]._st = true; this.setData({ list: l, _openIx: -1 }) } },
  onScroll: function () { if (this.data._openIx >= 0) this.closeAll() },
  measureListOverflow: function () {
    var that = this
    if (this._listMeasureTimer) clearTimeout(this._listMeasureTimer)
    this._listMeasureTimer = setTimeout(function () {
      if (that.data.empty) return
      var query = that.createSelectorQuery ? that.createSelectorQuery() : wx.createSelectorQuery().in(that)
      query.select('.list-scroll').boundingClientRect()
      query.select('.list-wrap').boundingClientRect()
      query.exec(function (rects) {
        var scroll = rects && rects[0]
        var wrap = rects && rects[1]
        if (!scroll || !wrap) return
        that.setData({ listHasOverflow: wrap.height > scroll.height + 8 })
      })
    }, 60)
  },

  onCardTap: function (e) {
    var ix = parseInt(e.currentTarget.dataset.ix), id = e.currentTarget.dataset.id
    var oldIx = this.data._openIx
    if (oldIx !== -1) {
      this.closeIt(oldIx)
      if (oldIx !== ix) {
        var s = this.getById(id); if (!s) return
        if (U.isExp(s)) { this.setData({ showExpModal: true }) } else { this.openClassForStudent(s) }
      }
      return
    }
    var s = this.getById(id); if (!s) return
    // 点击动效
    var list = this.data.list; if (list[ix]) { list[ix].highlight = 'card-hl-green'; this.setData({ list: list.slice() }); var that = this; if (this._cardTapTimer) clearTimeout(this._cardTapTimer); this._cardTapTimer = setTimeout(function () { list[ix].highlight = ''; that.setData({ list: list.slice() }); that._cardTapTimer = null }, 150) }
    if (U.isExp(s)) { this.setData({ showExpModal: true }) } else { this.openClassForStudent(s) }
  },

  openClassForStudent: function (student) {
    if (S.parseAmount(student.remainingLessons, 0) <= 0) {
      wx.showToast({ title: '剩余课时不足', icon: 'none', duration: 1800 })
      return
    }
    var pick = this.pickClassSchedule(student.id)
    if (!pick) {
      this.showClassForStudent(student, null, true)
      return
    }
    if (pick.multiOverdue) {
      this.showMultiOverdueForStudent(student)
      return
    }
    this.showClassForStudent(student, pick.schedule, true)
  },

  pickClassSchedule: function (studentId) {
    var schedules = app.globalData.schedules || []
    var overdue = []
    var active = []
    for (var i = 0; i < schedules.length; i++) {
      var sc = schedules[i]
      if (S.isHidden(sc) || sc.studentId != studentId || sc.status !== S.STATUS.SCHEDULED) continue
      var st = S.stateOf(sc, Date.now())
      if (st === S.STATE.OVERDUE) overdue.push(sc)
      else if (st === S.STATE.IN_PROGRESS || st === S.STATE.UPCOMING) active.push(sc)
    }
    overdue.sort(function (a, b) { return S.startTs(a) - S.startTs(b) })
    active.sort(function (a, b) { return S.startTs(a) - S.startTs(b) })
    if (overdue.length) return { schedule: overdue[0], state: S.STATE.OVERDUE, multiOverdue: overdue.length > 1 }
    if (active.length) return { schedule: active[0], state: S.stateOf(active[0], Date.now()), multiOverdue: false }
    return null
  },

  getStudentOverdueList: function (studentId) {
    var all = S.getRecentSchedules(app.globalData.schedules || [], app.globalData.students || [], U.today(), Date.now(), 14)
    var list = []
    for (var i = 0; i < all.length; i++) {
      if (all[i].studentId == studentId && all[i].overdue && all[i].status === S.STATUS.SCHEDULED) list.push(all[i])
    }
    list.sort(function (a, b) { return a.startTs - b.startTs })
    return list
  },

  getStudentActiveScheduleList: function (studentId) {
    return S.getStudentActiveSchedules(app.globalData.schedules || [], app.globalData.students || [], studentId, Date.now())
  },

  refreshStudentSchedules: function () {
    if (!this.data.showStudentSchedules || !this.data.studentScheduleTarget.id) return
    var student = this.getById(this.data.studentScheduleTarget.id)
    if (!student) {
      this.setData({ showStudentSchedules: false, studentScheduleTarget: {}, studentScheduleList: [], showScheduleDel: false, scheduleDelTarget: {} })
      return
    }
    this.setData({
      studentScheduleTarget: student,
      studentScheduleList: this.getStudentActiveScheduleList(student.id),
      showScheduleDel: false,
      scheduleDelTarget: {}
    })
  },

  refreshSchedulePopups: function () {
    this.refreshMultiOverdue()
    this.refreshStudentSchedules()
  },

  onViewSchedules: function (e) {
    var id = e.currentTarget.dataset.id
    var student = this.getById(id)
    if (!student) return
    var list = this.getStudentActiveScheduleList(student.id)
    var data = {
      showStudentSchedules: true,
      studentScheduleTarget: student,
      studentScheduleList: list,
      showScheduleDel: false,
      scheduleDelTarget: {}
    }
    var ix = this.data._openIx, cards = this.data.list
    if (ix >= 0 && cards[ix]) {
      cards[ix].open = false
      cards[ix]._sx = 0
      cards[ix]._st = false
      data.list = cards
      data._openIx = -1
    }
    this.setData(data)
  },

  closeStudentSchedules: function () {
    if (this.data.showClass || this.data.showScheduleDel || this.data.showScheduleEdit) return
    this.setData({ showStudentSchedules: false, studentScheduleTarget: {}, studentScheduleList: [] })
  },

  openStudentScheduleDetail: function (e) {
    var id = e.currentTarget.dataset.id
    var sc = S.findById(app.globalData.schedules || [], id)
    if (!sc || S.isHidden(sc) || sc.status !== S.STATUS.SCHEDULED) {
      wx.showToast({ title: '这节排课已变化', icon: 'none', duration: 1800 })
      var student = this.data.studentScheduleTarget
      if (student && student.id !== undefined) {
        this.setData({ studentScheduleList: this.getStudentActiveScheduleList(student.id) })
      }
      return
    }
    this.setData({ showStudentSchedules: false, studentScheduleTarget: {}, studentScheduleList: [] })
    wx.navigateTo({ url: '/pages/schedule/schedule?date=' + encodeURIComponent(sc.date) + '&scheduleId=' + encodeURIComponent(sc.id) + '&source=student' })
  },

  onStudentScheduleDeduct: function (e) {
    var id = e.currentTarget.dataset.id
    var sc = S.findById(app.globalData.schedules || [], id)
    var student = this.getById(sc ? sc.studentId : this.data.studentScheduleTarget.id)
    if (!sc || !student || S.isHidden(sc) || sc.status !== S.STATUS.SCHEDULED || !S.isActive(sc, Date.now())) {
      wx.showToast({ title: '这节排课已变化', icon: 'none', duration: 1800 })
      this.refreshStudentSchedules()
      return
    }
    this.showClassForStudent(student, sc, false)
  },

  onStudentScheduleReschedule: function (e) {
    this.openScheduleEditById(e.currentTarget.dataset.id, 'student')
  },

  onStudentScheduleDelete: function (e) {
    var id = e.currentTarget.dataset.id
    var list = this.data.studentScheduleList || []
    var target = null
    for (var i = 0; i < list.length; i++) {
      if (list[i].id == id) { target = list[i]; break }
    }
    if (!target) {
      wx.showToast({ title: '这节排课已变化', icon: 'none', duration: 1800 })
      this.refreshStudentSchedules()
      return
    }
    this.setData({ showScheduleDel: true, scheduleDelTarget: target })
  },

  showMultiOverdueForStudent: function (student) {
    var list = this.getStudentOverdueList(student.id)
    if (list.length <= 1) {
      this.showClassForStudent(student, list[0] ? S.findById(app.globalData.schedules || [], list[0].id) : null, false)
      return
    }
    this.setData({
      showMultiOverdue: true,
      multiOverdueStudent: student,
      multiOverdueList: list,
      showScheduleDel: false,
      scheduleDelTarget: {}
    })
  },

  refreshMultiOverdue: function () {
    if (!this.data.showMultiOverdue || !this.data.multiOverdueStudent.id) return
    var student = this.getById(this.data.multiOverdueStudent.id)
    if (!student) {
      this.setData({ showMultiOverdue: false, multiOverdueStudent: {}, multiOverdueList: [], showScheduleDel: false, scheduleDelTarget: {} })
      return
    }
    var list = this.getStudentOverdueList(student.id)
    this.setData({
      showMultiOverdue: list.length > 0,
      multiOverdueStudent: list.length > 0 ? student : {},
      multiOverdueList: list,
      showScheduleDel: false,
      scheduleDelTarget: {}
    })
  },

  closeMultiOverdue: function () {
    if (this.data.showClass || this.data.showScheduleDel || this.data.showScheduleEdit) return
    this.setData({ showMultiOverdue: false, multiOverdueStudent: {}, multiOverdueList: [] })
  },

  onMultiDeduct: function (e) {
    var id = e.currentTarget.dataset.id
    var sc = S.findById(app.globalData.schedules || [], id)
    var student = this.getById(sc ? sc.studentId : this.data.multiOverdueStudent.id)
    if (!sc || !student) {
      wx.showToast({ title: '这节排课已变化', icon: 'none', duration: 1800 })
      this.refreshMultiOverdue()
      return
    }
    if (S.isHidden(sc) || sc.status !== S.STATUS.SCHEDULED || S.stateOf(sc, Date.now()) !== S.STATE.OVERDUE) {
      wx.showToast({ title: '这节排课已变化', icon: 'none', duration: 1800 })
      this.refreshMultiOverdue()
      return
    }
    this.showClassForStudent(student, sc, false)
  },

  onMultiReschedule: function (e) {
    this.openScheduleEditById(e.currentTarget.dataset.id, 'multi')
  },

  onMultiDelete: function (e) {
    var id = e.currentTarget.dataset.id
    var list = this.data.multiOverdueList || []
    var target = null
    for (var i = 0; i < list.length; i++) {
      if (list[i].id == id) { target = list[i]; break }
    }
    if (!target) {
      wx.showToast({ title: '这节排课已变化', icon: 'none', duration: 1800 })
      this.refreshMultiOverdue()
      return
    }
    this.setData({ showScheduleDel: true, scheduleDelTarget: target })
  },

  closeScheduleDel: function () {
    this.setData({ showScheduleDel: false, scheduleDelTarget: {} })
  },

  doScheduleDel: function () {
    var target = this.data.scheduleDelTarget
    if (!target || target.id === undefined) {
      this.setData({ showScheduleDel: false, scheduleDelTarget: {} })
      wx.showToast({ title: '这节排课已变化', icon: 'none', duration: 1800 })
      this.refreshSchedulePopups()
      return
    }
    var sc = S.findById(app.globalData.schedules || [], target.id)
    if (!sc || S.isHidden(sc) || sc.status !== S.STATUS.SCHEDULED || !S.isActive(sc, Date.now())) {
      this.setData({ showScheduleDel: false, scheduleDelTarget: {} })
      wx.showToast({ title: '这节排课已变化', icon: 'none', duration: 1800 })
      this.refreshSchedulePopups()
      return
    }
    sc.status = S.STATUS.DELETED
    sc.deleted = true
    sc.deletedAt = U.today()
    sc.updatedAt = Date.now()
    app.save()
    syncScheduleSafe(sc)
    this.setData({ showScheduleDel: false, scheduleDelTarget: {} })
    this.reload()
    this.refreshSchedulePopups()
    wx.showToast({ title: '已删除', icon: 'success', duration: 1200 })
  },

  getReservedLessons: function (studentId, excludeId) {
    var total = 0
    var schedules = app.globalData.schedules || []
    for (var i = 0; i < schedules.length; i++) {
      var sc = schedules[i]
      if (S.isHidden(sc) || sc.status !== S.STATUS.SCHEDULED || sc.studentId != studentId || sc.id == excludeId) continue
      total += S.plannedAmount(sc)
    }
    return Math.round(total * 10) / 10
  },

  getScheduleEditAmountLimit: function (studentId, excludeId) {
    var student = this.getById(studentId)
    if (!student) return 0
    var remaining = S.parseAmount(student.remainingLessons, 0)
    var reserved = this.getReservedLessons(student.id, excludeId)
    return Math.max(0, Math.round((remaining - reserved) * 10) / 10)
  },

  getScheduleEditUiAmountLimit: function (studentId, excludeId) {
    var hardLimit = this.getScheduleEditAmountLimit(studentId, excludeId)
    var sc = S.findById(app.globalData.schedules || [], excludeId)
    var oldAmount = sc ? S.plannedAmount(sc) : 0
    return Math.max(hardLimit, oldAmount)
  },

  findScheduleEditConflict: function (form) {
    if (!form || !form.studentId || !form.date || !form.startTime) return null
    var probe = { date: form.date, startTime: form.startTime, plannedAmount: form.plannedAmount }
    var start = S.startTs(probe)
    var end = S.endTs(probe)
    var schedules = app.globalData.schedules || []
    for (var i = 0; i < schedules.length; i++) {
      var sc = schedules[i]
      if (S.isHidden(sc) || sc.status !== S.STATUS.SCHEDULED || sc.studentId != form.studentId || sc.id == form.id) continue
      var otherStart = S.startTs(sc)
      var otherEnd = S.endTs(sc)
      if (start < otherEnd && end > otherStart) return sc
    }
    return null
  },

  openScheduleEditById: function (id, source) {
    var sc = S.findById(app.globalData.schedules || [], id)
    if (!sc || S.isHidden(sc) || sc.status !== S.STATUS.SCHEDULED || !S.isActive(sc, Date.now())) {
      wx.showToast({ title: '这节排课已变化', icon: 'none', duration: 1800 })
      this.refreshSchedulePopups()
      return
    }
    var student = this.getById(sc.studentId)
    if (!student) {
      wx.showToast({ title: '学员不存在', icon: 'none', duration: 1800 })
      this.refreshSchedulePopups()
      return
    }
    var amount = S.plannedAmount(sc)
    var customSelected = amount !== 1 && amount !== 2
    var note = sc.note || ''
    this._scheduleEditNoteDraft = note
    this._scheduleEditOriginal = {
      date: sc.date,
      startTime: S.formatHM(sc.startTime),
      plannedAmount: amount,
      note: note
    }
    this.setData({
      showScheduleEdit: true,
      scheduleEditSource: source || '',
      scheduleEditForm: {
        id: sc.id,
        studentId: sc.studentId,
        studentName: student.name,
        avatarSrc: student.avatarSrc || '/images/avatars/avatar_1.png',
        date: sc.date,
        startTime: S.formatHM(sc.startTime),
        plannedAmount: amount,
        customAmount: customSelected ? S.formatAmount(amount) : '',
        customSelected: customSelected,
        note: note
      },
      scheduleEditAmountLimit: this.getScheduleEditUiAmountLimit(sc.studentId, sc.id),
      scheduleEditAmountShake: false,
      scheduleEditNoteCount: note.length,
      scheduleEditSaving: false,
      scheduleEditY: 0,
      scheduleEditMaskOpacity: 1,
      scheduleEditTransition: 'transform 240ms cubic-bezier(.2,.8,.2,1)',
      scheduleEditBodyScrollEnabled: true
    })
  },

  getScheduleEditOffscreenY: function () {
    try {
      return (wx.getSystemInfoSync().windowHeight || 800) + 40
    } catch (e) {
      return 840
    }
  },

  closeScheduleEdit: function () {
    if (this.data.scheduleEditSaving) return
    if (this.isScheduleEditDirty()) {
      this.openScheduleEditConfirm({
        action: 'discard',
        title: '还没保存',
        desc: '当前修改还没有保存，确定退出吗？',
        okText: '退出',
        danger: true
      })
      return
    }
    this.resetScheduleEdit()
  },

  resetScheduleEdit: function () {
    this._scheduleEditNoteDraft = ''
    this._scheduleEditOriginal = null
    this._pendingScheduleEdit = null
    this._scheduleEditConfirmAction = ''
    this._scheduleEditTouch = null
    this._scheduleEditCurrentY = 0
    if (this._scheduleEditCloseTimer) {
      clearTimeout(this._scheduleEditCloseTimer)
      this._scheduleEditCloseTimer = null
    }
    this.setData({
      showScheduleEdit: false,
      scheduleEditSource: '',
      scheduleEditForm: {},
      scheduleEditAmountLimit: 0,
      scheduleEditAmountShake: false,
      scheduleEditNoteCount: 0,
      scheduleEditSaving: false,
      scheduleEditY: 0,
      scheduleEditMaskOpacity: 1,
      scheduleEditTransition: 'transform 240ms cubic-bezier(.2,.8,.2,1)',
      scheduleEditBodyScrollEnabled: true,
      showScheduleEditConfirm: false,
      scheduleEditConfirmTitle: '',
      scheduleEditConfirmDesc: '',
      scheduleEditConfirmOkText: '确定',
      scheduleEditConfirmDanger: false
    })
  },

  closeScheduleEditAnimated: function () {
    if (this.data.scheduleEditSaving) return
    var that = this
    var h = this.getScheduleEditOffscreenY()
    this._scheduleEditTouch = null
    this._scheduleEditCurrentY = h
    if (this._scheduleEditCloseTimer) clearTimeout(this._scheduleEditCloseTimer)
    this.setData({
      scheduleEditY: h,
      scheduleEditMaskOpacity: 0,
      scheduleEditTransition: 'transform 250ms cubic-bezier(.32,.72,.28,1)',
      scheduleEditBodyScrollEnabled: true
    })
    this._scheduleEditCloseTimer = setTimeout(function () {
      that.resetScheduleEdit()
    }, 270)
  },

  resetScheduleEditDragThenClose: function () {
    var that = this
    this._scheduleEditCurrentY = 0
    this.setData({
      scheduleEditY: 0,
      scheduleEditMaskOpacity: 1,
      scheduleEditTransition: 'transform 240ms cubic-bezier(.2,.8,.2,1)',
      scheduleEditBodyScrollEnabled: true
    }, function () {
      if (that._scheduleEditResetTimer) clearTimeout(that._scheduleEditResetTimer)
      that._scheduleEditResetTimer = setTimeout(function () {
        that._scheduleEditResetTimer = null
        that.closeScheduleEdit()
      }, 180)
    })
  },

  onScheduleEditBodyScroll: function (e) {
    this._scheduleEditScrollTop = (e.detail && e.detail.scrollTop) || 0
  },

  onScheduleEditBodyScrollToUpper: function () {
    this._scheduleEditScrollTop = 0
  },

  onScheduleEditTouchStart: function (e) {
    if (!this.data.showScheduleEdit || this.data.scheduleEditSaving) return
    var t = e.touches && e.touches[0]
    if (!t) return
    this._scheduleEditTouch = {
      startY: t.clientY,
      lastY: t.clientY,
      lastTime: Date.now(),
      dragStartY: 0,
      dragStartTime: 0,
      dragging: false
    }
  },

  onScheduleEditTouchMove: function (e) {
    var st = this._scheduleEditTouch
    if (!st || this.data.scheduleEditSaving) return
    var t = e.touches && e.touches[0]
    if (!t) return
    var dy = t.clientY - st.startY
    st.lastY = t.clientY
    st.lastTime = Date.now()
    if (!st.dragging) {
      if (dy <= 8 || (this._scheduleEditScrollTop || 0) > 2) return
      st.dragging = true
      st.dragStartY = t.clientY
      st.dragStartTime = Date.now()
      this._scheduleEditCurrentY = 0
      this.setData({
        scheduleEditTransition: 'none',
        scheduleEditBodyScrollEnabled: false
      })
      return
    }
    var y = Math.max(0, Math.round((t.clientY - st.dragStartY) * 0.86))
    if (Math.abs(y - (this._scheduleEditCurrentY || 0)) < 2) return
    this._scheduleEditCurrentY = y
    this.setData({
      scheduleEditY: y,
      scheduleEditMaskOpacity: Math.max(0.18, 1 - y / 520)
    })
  },

  onScheduleEditTouchEnd: function () {
    var st = this._scheduleEditTouch
    this._scheduleEditTouch = null
    if (!st || !st.dragging) {
      this.setData({ scheduleEditBodyScrollEnabled: true })
      return
    }
    var y = this._scheduleEditCurrentY || 0
    var velocity = y / Math.max(1, Date.now() - (st.dragStartTime || Date.now()))
    if (y > 120 || velocity > 0.55) {
      if (this.isScheduleEditDirty()) {
        this.resetScheduleEditDragThenClose()
        return
      }
      this.closeScheduleEditAnimated()
      return
    }
    this._scheduleEditCurrentY = 0
    this.setData({
      scheduleEditY: 0,
      scheduleEditMaskOpacity: 1,
      scheduleEditTransition: 'transform 240ms cubic-bezier(.2,.8,.2,1)',
      scheduleEditBodyScrollEnabled: true
    })
  },

  onScheduleEditTouchCancel: function () {
    this._scheduleEditTouch = null
    this._scheduleEditCurrentY = 0
    this.setData({
      scheduleEditY: 0,
      scheduleEditMaskOpacity: 1,
      scheduleEditTransition: 'transform 240ms cubic-bezier(.2,.8,.2,1)',
      scheduleEditBodyScrollEnabled: true
    })
  },

  isScheduleEditDirty: function () {
    if (!this.data.showScheduleEdit) return false
    var origin = this._scheduleEditOriginal
    var form = this.data.scheduleEditForm || {}
    if (!origin) return false
    var note = typeof this._scheduleEditNoteDraft === 'string' ? this._scheduleEditNoteDraft : (form.note || '')
    return origin.date !== form.date ||
      origin.startTime !== form.startTime ||
      S.parseAmount(origin.plannedAmount, 0) !== S.parseAmount(form.plannedAmount, 0) ||
      (origin.note || '') !== (note || '')
  },

  openScheduleEditConfirm: function (opts) {
    this._scheduleEditConfirmAction = opts.action || ''
    this.setData({
      showScheduleEditConfirm: true,
      scheduleEditConfirmTitle: opts.title || '确认操作',
      scheduleEditConfirmDesc: opts.desc || '',
      scheduleEditConfirmOkText: opts.okText || '确定',
      scheduleEditConfirmDanger: !!opts.danger
    })
  },

  closeScheduleEditConfirm: function () {
    this._scheduleEditConfirmAction = ''
    this._pendingScheduleEdit = null
    this.setData({ showScheduleEditConfirm: false, scheduleEditConfirmTitle: '', scheduleEditConfirmDesc: '', scheduleEditConfirmOkText: '确定', scheduleEditConfirmDanger: false })
  },

  confirmScheduleEditDialog: function () {
    var action = this._scheduleEditConfirmAction
    var pending = this._pendingScheduleEdit
    this._scheduleEditConfirmAction = ''
    this._pendingScheduleEdit = null
    this.setData({ showScheduleEditConfirm: false, scheduleEditConfirmTitle: '', scheduleEditConfirmDesc: '', scheduleEditConfirmOkText: '确定', scheduleEditConfirmDanger: false })
    if (action === 'discard') {
      this.resetScheduleEdit()
      return
    }
    if (action === 'pastSave' && pending) {
      this.commitScheduleEdit(pending)
    }
  },

  onScheduleEditDate: function (e) {
    this.setData({ 'scheduleEditForm.date': e.detail.value })
  },

  onScheduleEditTime: function (e) {
    this.setData({ 'scheduleEditForm.startTime': e.detail.value })
  },

  shakeScheduleEditAmount: function () {
    var that = this
    this.setData({ scheduleEditAmountShake: false }, function () {
      if (that._scheduleEditShakeTimer1) clearTimeout(that._scheduleEditShakeTimer1)
      if (that._scheduleEditShakeTimer2) clearTimeout(that._scheduleEditShakeTimer2)
      that._scheduleEditShakeTimer1 = setTimeout(function () {
        that._scheduleEditShakeTimer1 = null
        that.setData({ scheduleEditAmountShake: true })
        that._scheduleEditShakeTimer2 = setTimeout(function () { that.setData({ scheduleEditAmountShake: false }); that._scheduleEditShakeTimer2 = null }, 360)
      }, 20)
    })
  },

  onScheduleEditAmountQuick: function (e) {
    var v = parseInt(e.currentTarget.dataset.v) || 1
    var max = this.getScheduleEditUiAmountLimit(this.data.scheduleEditForm.studentId, this.data.scheduleEditForm.id)
    if (v > max) {
      wx.showToast({ title: '剩余课时不足', icon: 'none', duration: 2000 })
      this.shakeScheduleEditAmount()
      return
    }
    this.setData({ 'scheduleEditForm.plannedAmount': v, 'scheduleEditForm.customAmount': '', 'scheduleEditForm.customSelected': false, scheduleEditAmountLimit: max })
  },

  onScheduleEditAmountFocus: function () {
    var val = this.data.scheduleEditForm.customAmount || ''
    var n = val ? S.parseAmount(val, 0) : ''
    this.setData({ 'scheduleEditForm.customSelected': true, 'scheduleEditForm.plannedAmount': n })
  },

  onScheduleEditAmountInput: function (e) {
    var max = this.getScheduleEditUiAmountLimit(this.data.scheduleEditForm.studentId, this.data.scheduleEditForm.id)
    var cleaned = S.cleanHalfAmountInput(e.detail.value, max)
    if (cleaned.capped) {
      wx.showToast({ title: '剩余课时不足', icon: 'none', duration: 2000 })
      this.shakeScheduleEditAmount()
    } else if (cleaned.invalidHalf) {
      wx.showToast({ title: '只支持半节课', icon: 'none', duration: 1600 })
    }
    this.setData({ 'scheduleEditForm.customAmount': cleaned.value, 'scheduleEditForm.plannedAmount': cleaned.amount, 'scheduleEditForm.customSelected': true, scheduleEditAmountLimit: max })
  },

  onScheduleEditNote: function (e) {
    var val = (e.detail && e.detail.value) || ''
    this._scheduleEditNoteDraft = val
    this.setData({ scheduleEditNoteCount: val.length })
  },

  onScheduleEditNoteBlur: function (e) {
    var val = (e.detail && e.detail.value) || ''
    this._scheduleEditNoteDraft = val
    this.setData({ 'scheduleEditForm.note': val, scheduleEditNoteCount: val.length })
  },

  saveScheduleEdit: function () {
    if (this.data.scheduleEditSaving) return
    var f0 = this.data.scheduleEditForm || {}
    var f = {
      id: f0.id,
      studentId: f0.studentId,
      studentName: f0.studentName,
      avatarSrc: f0.avatarSrc,
      date: f0.date,
      startTime: f0.startTime,
      plannedAmount: S.parseAmount(f0.plannedAmount, 0),
      note: typeof this._scheduleEditNoteDraft === 'string' ? this._scheduleEditNoteDraft : (f0.note || '')
    }
    if (!f.date || !f.startTime) { wx.showToast({ title: '请选择上课时间', icon: 'none', duration: 1800 }); return }
    if (f.plannedAmount <= 0) { wx.showToast({ title: '请输入排课节数', icon: 'none', duration: 1800 }); return }
    var student = this.getById(f.studentId)
    if (!student) { wx.showToast({ title: '学员不存在', icon: 'none', duration: 1800 }); return }
    var oldSchedule = S.findById(app.globalData.schedules || [], f.id)
    var oldAmount = oldSchedule ? S.plannedAmount(oldSchedule) : 0
    var limit = this.getScheduleEditAmountLimit(f.studentId, f.id)
    var worsensReserve = !oldSchedule || f.plannedAmount > oldAmount
    if (f.plannedAmount > limit && worsensReserve) {
      wx.showToast({ title: '已排课时超过剩余课时', icon: 'none', duration: 2000 })
      this.shakeScheduleEditAmount()
      return
    }
    if (this.findScheduleEditConflict(f)) {
      wx.showToast({ title: '该时间已有排课', icon: 'none', duration: 2000 })
      return
    }
    if (S.toDateTime(f.date, f.startTime).getTime() < Date.now()) {
      this._pendingScheduleEdit = f
      this.openScheduleEditConfirm({
        action: 'pastSave',
        title: '排课时间已过',
        desc: '保存后会按当前时间显示为上课中或未消课，确定继续吗？',
        okText: '继续保存',
        danger: false
      })
      return
    }
    this.commitScheduleEdit(f)
  },

  commitScheduleEdit: function (f) {
    var sc = S.findById(app.globalData.schedules || [], f.id)
    if (!sc || S.isHidden(sc) || sc.status !== S.STATUS.SCHEDULED) {
      wx.showToast({ title: '这节排课已变化', icon: 'none', duration: 1800 })
      this.resetScheduleEdit()
      this.refreshSchedulePopups()
      return
    }
    var student = this.getById(f.studentId)
    if (!student) {
      wx.showToast({ title: '学员不存在', icon: 'none', duration: 1800 })
      this.resetScheduleEdit()
      this.refreshSchedulePopups()
      return
    }
    this.setData({ scheduleEditSaving: true })
    sc.studentName = student.name
    sc.avatarSrc = student.avatarSrc || '/images/avatars/avatar_1.png'
    sc.date = f.date
    sc.startTime = f.startTime
    sc.plannedAmount = f.plannedAmount
    sc.note = f.note
    sc.updatedAt = Date.now()
    app.save()
    syncScheduleSafe(sc)
    this.resetScheduleEdit()
    this.reload()
    this.refreshSchedulePopups()
    this.showOkText('已保存')
  },

  showClassForStudent: function (student, schedule, restoreScheduleOnUndo) {
    var amount = schedule ? S.plannedAmount(schedule) : 1
    var remain = S.parseAmount(student.remainingLessons, 0)
    if (amount > remain) amount = remain > 0 ? remain : 1
    var customSelected = !!schedule && amount !== 1 && amount !== 2
    var openedAt = new Date()
    var state = schedule ? S.stateOf(schedule, openedAt.getTime()) : ''
    var title = '选择消课节数'
    if (schedule) title = state === S.STATE.UPCOMING ? '确认提前消课吗？' : (state === S.STATE.IN_PROGRESS ? '选择消课节数' : '确认排课消课')
    this._classSubmitting = false
    this._classMoreConfirming = false
    var diff = schedule ? this.calcClassLessonDiff(amount, S.plannedAmount(schedule)) : { extra: 0, less: 0 }
    this.setData({ showClass: true, classTarget: student, classAmount: amount, classCustom: customSelected ? S.formatAmount(amount) : '', classCustomSelected: customSelected, classSchedule: schedule || null, classRestoreScheduleOnUndo: !!restoreScheduleOnUndo, classScheduleState: state, classTitle: title, classScheduleAmountText: schedule ? S.formatAmount(S.plannedAmount(schedule)) : '', classScheduleTimeText: formatClassScheduleTime(schedule), classConfirmTimeText: state === S.STATE.UPCOMING ? formatCurrentClassTime(openedAt) : '', classExtraAmount: diff.extra, classLessAmount: diff.less, classSubmitting: false })
  },

  // ===== 横幅 =====
  dismissSwipeHint: function () { app.globalData.swipeHintDismissed = true; app.save(); this.setData({ showSwipeBanner: false }) },
  dismissSleepy: function () { app.globalData.bannerDismissedToday.sleepy = true; app.save(); this.setData({ showSleepy: false }) },
  dismissExpiry: function () { app.globalData.bannerDismissedToday.expiry = true; app.save(); this.setData({ showExpiry: false }) },
  dismissMember: function () { app.globalData.bannerDismissedToday.memberExpired = true; app.save(); this.setData({ showMember: false }) },

  // ===== 添加 =====
  onAddTap: function () {
    this.closeAll()
    var pro = this.data.isPro && !app.globalData.memberExpired, cnt = this.data.activeCnt
    if (!pro && cnt >= FREE_STUDENT_LIMIT) { A.track('upgrade_show'); app.globalData.upgradeShown = true; app.save(); this.setData({ showUpg: true, upgradeTitle: '免费版学员已满', plan: U.PLAN.MONTHLY }); return }
    this.onAdd()
  },

  onAdd: function () {
    this.setData({
      showForm: true, editing: false, nameFocus: true,
      fd: { avatarSrc: rem(), name: '', totalLessons: 24, expiryDate: U.addMonths(U.today(), 6), note: '' }
    })
  },

  closeForm: function () { this.setData({ showForm: false, editing: false, nameFocus: false }) },
  randAv: function () { this.setData({ 'fd.avatarSrc': rem(this.data.fd.avatarSrc) }) },
  onFdName: function (e) { this.setData({ 'fd.name': e.detail.value }) },
  onFdLessons: function (e) {
    var cleaned = S.cleanHalfAmountInput(e.detail.value)
    if (cleaned.invalidHalf) {
      wx.showToast({ title: '只支持半节课', icon: 'none', duration: 1600 })
    }
    this.setData({ 'fd.totalLessons': cleaned.value })
  },
  onQuick: function (e) { this.setData({ 'fd.totalLessons': parseInt(e.currentTarget.dataset.v) }) },
  onFdDate: function (e) { this.setData({ 'fd.expiryDate': e.detail.value }) },
  onFdNote: function (e) { this.setData({ 'fd.note': e.detail.value }) },

  onEdit: function (e) {
    var id = e.currentTarget.dataset.id, s = this.getById(id); if (!s) return
    var formData = {
      showForm: true, editing: true, editId: id, nameFocus: false,
      fd: { avatarSrc: s.avatarSrc || '/images/avatars/avatar_1.png', name: s.name, totalLessons: s.remainingLessons, expiryDate: s.expiryDate || '', note: s.note || '' }
    }
    var ix = this.data._openIx, list = this.data.list
    if (ix >= 0 && list[ix]) {
      list[ix].open = false; list[ix]._sx = 0; list[ix]._st = false
      var that = this
      this.setData({ list: list, _openIx: -1 }, function () {
        that.setData(formData)
      })
      return
    }
    this.setData(formData)
  },

  submitForm: function () {
    var fd = this.data.fd
    if (!fd.name || !fd.name.trim()) { wx.showToast({ title: '请输入学员姓名', icon: 'none', duration: 2000 }); return }
    var lessons = S.parseAmount(fd.totalLessons, 0)
    if (!lessons || lessons <= 0) { wx.showToast({ title: '请输入课时数', icon: 'none', duration: 2000 }); return }
    if (this.data.editing) {
      var reservedLessons = this.getReservedLessons(this.data.editId)
      if (reservedLessons > 0 && lessons + 0.0001 < reservedLessons) {
        wx.showToast({ title: '已排课' + S.formatAmount(reservedLessons) + '节，不能低于它', icon: 'none', duration: 2200 })
        return
      }
    }
    fd.totalLessons = lessons
    var ss = app.globalData.students.slice()
    if (this.data.editing) {
      for (var i = 0; i < ss.length; i++) {
        if (ss[i].id == this.data.editId) {
          var diff = fd.totalLessons - ss[i].remainingLessons
          ss[i].name = fd.name.trim(); ss[i].avatarSrc = fd.avatarSrc
          ss[i].remainingLessons = fd.totalLessons; ss[i].totalLessons = fd.totalLessons
          ss[i].expiryDate = fd.expiryDate; ss[i].note = fd.note.trim(); ss[i].lastModified = Date.now()
          if (!ss[i].history) ss[i].history = []
          if (diff > 0) {
            ss[i].history.unshift({ type: U.REC.RECHARGE, amount: diff, time: U.today() + ' ' + U.formatTime(), ts: Date.now() })
          } else if (diff < 0) {
            ss[i].history.unshift({ type: U.REC.DEDUCT, amount: Math.abs(diff), time: U.today() + ' ' + U.formatTime(), ts: Date.now() })
          }
          if (!ss[i].lastClassDate) ss[i].lastClassDate = ''
          break
        }
      }
    } else {
      ss.push({
        id: app.globalData.nextId++, name: fd.name.trim(), avatarSrc: fd.avatarSrc,
        remainingLessons: fd.totalLessons, totalLessons: fd.totalLessons,
        expiryDate: fd.expiryDate, note: fd.note.trim(),
        lastClassDate: '', history: [{ type: U.REC.RECHARGE, amount: fd.totalLessons, time: U.today() + ' ' + U.formatTime(), ts: Date.now() }], deleted: false, createdAt: U.today(), lastModified: Date.now()
      })
    }
    app.globalData.students = ss; app.save()
    var wasEditing = this.data.editing, editId = this.data.editId
    var newId = wasEditing ? 0 : app.globalData.nextId - 1
    A.track(wasEditing ? 'student_edit' : 'student_add')
    // 云端同步新/编辑的学员
    if (C.isReady()) {
      var synced = wasEditing ? ss.filter(function (s) { return s.id == editId })[0] : ss[ss.length - 1]
      if (synced) syncStudentSafe(synced)
    }
    this.setData({ showForm: false, editing: false })
    if (wasEditing || this.data.activeCnt > 0) this.showOk()
    this.reload()
    if (wasEditing) {
      var list = this.data.list, targetItem = null
      for (var k = 0; k < list.length; k++) { if (list[k].id == editId) { targetItem = list[k]; break } }
      if (targetItem) this.flashCard(list, targetItem)
      this.scrollToTop()
    } else {
      // 新学员卡片高亮
      var list = this.data.list, addedItem = null
      for (var k = 0; k < list.length; k++) { if (list[k].id == newId) { addedItem = list[k]; break } }
      if (addedItem) this.flashCard(list, addedItem)
      // 首次添加学员：1秒后触发左滑提示动画
      if (this.data.activeCnt === 1) this.showSwipeHint()
    }
  },

  showSwipeHint: function () {
    var that = this
    if (this._swipeHintTimer1) clearTimeout(this._swipeHintTimer1)
    if (this._swipeHintTimer2) clearTimeout(this._swipeHintTimer2)
    this._swipeHintTimer1 = setTimeout(function () {
      that._swipeHintTimer1 = null
      that.setData({ showHintT: true })
      that._swipeHintTimer2 = setTimeout(function () {
        that.setData({ showHintT: false })
        that._swipeHintTimer2 = null
      }, 2000)
    }, 1000)
  },

  // ===== 彩蛋 =====
  onGuideTap: function () {
    var that = this
    this._guideTapCount++
    if (this._guideTapTimer) clearTimeout(this._guideTapTimer)
    if (this._guideTapCount >= 2) {
      if (this.data.showEasterT) {
        // toast还在 → 触发彩蛋！
        this.setData({ showEasterT: false })
        this._guideTapCount = 0
        var claimed = wx.getStorageSync('_easter_egg_claimed') || false
        that.setData({ showEasterEgg: true, easterClaimed: !!claimed, confetti: that.makeConfetti() })
        // 如果本地标记没恢复，再查一次云端
        if (!claimed && C.isReady()) {
          C.pullEasterClaimed(function (c) {
            if (c) { wx.setStorageSync('_easter_egg_claimed', true); that.setData({ easterClaimed: true }) }
          })
        }
        try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
        return
      }
      // 首次双击 → 弹出神秘文案
      this.setData({ showEasterT: true })
      this._guideTapCount = 0
      if (this._easterToastTimer) clearTimeout(this._easterToastTimer)
      this._easterToastTimer = setTimeout(function () { that.setData({ showEasterT: false }); that._easterToastTimer = null }, 1000)
      return
    }
    this._guideTapTimer = setTimeout(function () { that._guideTapCount = 0 }, 800)
  },

  closeEasterEgg: function () { this.setData({ showEasterEgg: false, confetti: [] }) },

  makeConfetti: function () {
    var arr = []
    var colors = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ff922b','#f06595','#20c997','#cc5de8','#ff8787','#74c0fc','#da77f2','#ffe066']
    var sys = wx.getSystemInfoSync()
    var ww = 750
    var wh = Math.ceil(sys.screenHeight * 750 / sys.screenWidth) // actual screen height in rpx
    for (var i = 0; i < 400; i++) {
      // Random edge as starting position
      var edge = Math.floor(Math.random() * 4) // 0=top, 1=right, 2=bottom, 3=left
      var sx, sy, dx, dy
      if (edge === 0) { // top edge
        sx = Math.random() * ww; sy = -40
        dx = (Math.random() - 0.5) * 300; dy = wh * (0.4 + Math.random() * 0.6)
      } else if (edge === 1) { // right edge
        sx = ww + 40; sy = Math.random() * wh
        dx = -ww * (0.3 + Math.random() * 0.7); dy = (Math.random() - 0.5) * 400
      } else if (edge === 2) { // bottom edge
        sx = Math.random() * ww; sy = wh + 40
        dx = (Math.random() - 0.5) * 300; dy = -wh * (0.4 + Math.random() * 0.6)
      } else { // left edge
        sx = -40; sy = Math.random() * wh
        dx = ww * (0.3 + Math.random() * 0.7); dy = (Math.random() - 0.5) * 400
      }
      var dir
      if (edge === 0) dir = 'cf-down'
      else if (edge === 1) dir = 'cf-left'
      else if (edge === 2) dir = 'cf-up'
      else dir = 'cf-right'
      arr.push({
        sx: sx, sy: sy, dir: dir,
        color: colors[i % colors.length],
        size: 16 + Math.floor(Math.random() * 24),
        delay: Math.random() * 0.5,
        isCircle: Math.random() > 0.5
      })
    }
    return arr
  },

  confirmEasterEgg: function () {
    var that = this
    if (!this.data.easterClaimed) {
      A.track('easter_claimed')
      // 首次触发：领取1个月会员
      wx.setStorageSync('_easter_egg_claimed', true)
      app.globalData.upgradeShown = true
      // 永久会员不叠加彩蛋时长
      var isLifetime = app.globalData.isProMember && !app.globalData.memberExpired && !app.globalData.proExpiry
      var isLifetime = app.globalData.isProMember && !app.globalData.memberExpired && !app.globalData.proExpiry
      if (!isLifetime) {
        var base = app.globalData.proExpiry > U.today() ? app.globalData.proExpiry : U.today()
        app.globalData.proExpiry = U.addMonths(base, 1)
      }
      app.globalData.isProMember = true
      app.globalData.memberExpired = false
      app.save()
      // 云端同步彩蛋标记
      if (C.isReady()) {
        C.syncEasterClaimed()
      } else {
        wx.setStorageSync('_pending_easter_sync', true)
      }
      this.setData({ showEasterEgg: false, easterClaimed: true, isPro: true })
    } else {
      this.setData({ showEasterEgg: false })
    }
  },
  onDel: function (e) {
    var id = e.currentTarget.dataset.id, s = this.getById(id); if (!s) return
    var data = { showDel: true, delTarget: s }
    var ix = this.data._openIx, list = this.data.list
    if (ix >= 0 && list[ix]) {
      list[ix].open = false; list[ix]._sx = 0; list[ix]._st = false
      data.list = list; data._openIx = -1
    }
    this.setData(data)
  },
  closeDel: function () { this.setData({ showDel: false }) },
  doDel: function () {
    var target = this.data.delTarget || {}
    var tid = target.id
    var targetUid = target.studentUid || ''
    var targetCloudId = target._cloudId || ''
    var now = Date.now()
    app.globalData.students = app.globalData.students.map(function (s) {
      if (s.id == tid) {
        s.deleted = true
        s.deletedAt = U.today()
        s.updatedAt = now
        syncStudentSafe(s)
      }
      return s
    })
    var keptSchedules = []
    var schedules = app.globalData.schedules || []
    for (var si = 0; si < schedules.length; si++) {
      var sc = schedules[si]
      var matched = sc && (sc.studentId == tid || (targetUid && sc.studentUid === targetUid) || (targetCloudId && sc.studentCloudId === targetCloudId))
      if (matched) {
        sc.status = S.STATUS.DELETED
        sc.deleted = true
        sc.deletedAt = U.today()
        sc.updatedAt = now
        syncScheduleSafe(sc)
      } else {
        keptSchedules.push(sc)
      }
    }
    app.globalData.schedules = keptSchedules
    app.save(); this.setData({ showDel: false })
    A.track('student_delete')
    var hasActive = false, ss = app.globalData.students
    for (var i = 0; i < ss.length; i++) { if (!ss[i].deleted) { hasActive = true; break } }
    if (hasActive) this.showOk()
    this.reload()
  },

  // ===== 消课 =====
  closeClass: function () { this._classSubmitting = false; this._classMoreConfirming = false; this.setData({ showClass: false, classCustom: '', classCustomSelected: false, classSchedule: null, classRestoreScheduleOnUndo: false, classScheduleState: '', classTitle: '选择消课节数', classScheduleAmountText: '', classScheduleTimeText: '', classConfirmTimeText: '', classExtraAmount: 0, classLessAmount: 0, classSubmitting: false }) },
  calcClassLessonDiff: function (actual, planned) {
    return S.lessonDiff(actual, planned)
  },
  onClassQuick: function (e) {
    var v = parseInt(e.currentTarget.dataset.v) || 1
    var remain = S.parseAmount(this.data.classTarget.remainingLessons, 0)
    if (v > remain) { wx.showToast({ title: '剩余课时不足', icon: 'none', duration: 2000 }); return }
    var diff = this.data.classSchedule ? this.calcClassLessonDiff(v, S.plannedAmount(this.data.classSchedule)) : { extra: 0, less: 0 }
    this.setData({ classAmount: v, classCustom: '', classCustomSelected: false, classExtraAmount: diff.extra, classLessAmount: diff.less })
  },
  onClassCustomFocus: function () {
    var v = S.parseAmount(this.data.classCustom, 0)
    var diff = this.data.classSchedule ? this.calcClassLessonDiff(v, S.plannedAmount(this.data.classSchedule)) : { extra: 0, less: 0 }
    this.setData({ classAmount: v, classCustomSelected: true, classExtraAmount: diff.extra, classLessAmount: diff.less })
  },
  onClassCustom: function (e) {
    var remain = S.parseAmount(this.data.classTarget.remainingLessons, 0)
    var cleaned = S.cleanHalfAmountInput(e.detail.value, remain)
    var v = cleaned.amount
    var val = cleaned.value
    if (cleaned.capped) {
      wx.showToast({ title: '剩余课时不足', icon: 'none', duration: 2000 })
    } else if (cleaned.invalidHalf) {
      wx.showToast({ title: '只支持半节课', icon: 'none', duration: 1600 })
    }
    var diff = this.data.classSchedule ? this.calcClassLessonDiff(v, S.plannedAmount(this.data.classSchedule)) : { extra: 0, less: 0 }
    this.setData({ classAmount: v, classCustom: val, classCustomSelected: true, classExtraAmount: diff.extra, classLessAmount: diff.less })
  },
  doClass: function () {
    if (this._classSubmitting || this._classMoreConfirming || this.data.classSubmitting) return
    var t = this.data.classTarget, rawAmt = S.parseAmount(this.data.classAmount, 0)
    var amt = isNaN(rawAmt) ? 0 : rawAmt
    var sc = this.data.classSchedule
    var restoreScheduleOnUndo = !!this.data.classRestoreScheduleOnUndo
    if (amt <= 0) { wx.showToast({ title: '请输入消课节数', icon: 'none', duration: 1800 }); return }
    this.finishClass(t, amt, sc, restoreScheduleOnUndo)
  },

  finishClass: function (t, amt, linkedSchedule, restoreScheduleOnUndo) {
    if (this._classSubmitting || this.data.classSubmitting) return
    this._classSubmitting = true
    this.setData({ classSubmitting: true })
    var td = U.today(), tm = U.formatTime()
    A.track('deduct', { amount: amt, studentId: t.id })
    var student = this.getById(t.id)
    if (!student) { this._classSubmitting = false; this.setData({ classSubmitting: false }); return }
    var remain = S.parseAmount(student.remainingLessons, 0)
    if (amt > remain) { this._classSubmitting = false; this.setData({ classSubmitting: false }); wx.showToast({ title: '剩余课时不足', icon: 'none', duration: 2000 }); return }
    var oldRemaining = student.remainingLessons
    var oldLastClassDate = student.lastClassDate || ''
    var now = Date.now()
    var histTs = now
    var scheduleId = ''
    var walkIn = false
    var sc = linkedSchedule ? S.findById(app.globalData.schedules || [], linkedSchedule.id) : null
    var changedSchedule = null
    var earlyCompleted = false
    if (sc) {
      if (sc.status === S.STATUS.COMPLETED) {
        this._classSubmitting = false
        this.setData({ classSubmitting: false, showClass: false, classSchedule: null })
        wx.showToast({ title: '这节课已消课', icon: 'none', duration: 1800 })
        this.reload()
        this.refreshSchedulePopups()
        return
      }
      if (S.isHidden(sc) || sc.status !== S.STATUS.SCHEDULED) {
        this._classSubmitting = false
        this.setData({ classSubmitting: false, showClass: false, classSchedule: null })
        wx.showToast({ title: '这节排课已变化', icon: 'none', duration: 1800 })
        this.reload()
        this.refreshSchedulePopups()
        return
      }
      scheduleId = sc.id
      var originalScheduleDate = sc.date
      var originalScheduleStartTime = sc.startTime
      earlyCompleted = S.stateOf(sc, now) === S.STATE.UPCOMING
      sc.status = S.STATUS.COMPLETED
      sc.actualAmount = amt
      sc.earlyCompleted = earlyCompleted
      sc.completeNote = earlyCompleted ? '提前消课' : ''
      if (earlyCompleted) {
        sc.originalDate = sc.originalDate || originalScheduleDate
        sc.originalStartTime = sc.originalStartTime || originalScheduleStartTime
        sc.date = td
        sc.startTime = tm
      }
      sc.completedAt = now
      sc.linkedHistoryTs = histTs
      sc.beforeRemaining = oldRemaining
      sc.beforeLastClassDate = oldLastClassDate
      sc.updatedAt = now
      changedSchedule = sc
    } else {
      walkIn = true
      scheduleId = app.globalData.nextScheduleId++
      if (!app.globalData.schedules) app.globalData.schedules = []
      changedSchedule = {
        id: scheduleId,
        studentId: student.id,
        studentName: student.name,
        avatarSrc: student.avatarSrc || '/images/avatars/avatar_1.png',
        date: td,
        startTime: tm,
        plannedAmount: amt,
        actualAmount: amt,
        type: S.TYPE.WALK_IN,
        status: S.STATUS.COMPLETED,
        note: '临时消课',
        completeNote: '',
        linkedHistoryTs: histTs,
        beforeRemaining: oldRemaining,
        beforeLastClassDate: oldLastClassDate,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        deleted: false
      }
      app.globalData.schedules.push(changedSchedule)
    }
    student.remainingLessons = Math.max(0, S.parseAmount(oldRemaining, 0) - amt)
    student.lastClassDate = sc ? sc.date : td
    student.lastModified = now
    var histTime = (sc ? sc.date : td) + ' ' + (sc ? S.formatHM(sc.startTime) : tm)
    student.history = [{
      type: U.REC.DEDUCT,
      amount: amt,
      time: histTime,
      ts: histTs,
      scheduleId: scheduleId,
      scheduleDate: sc ? sc.date : td,
      plannedAmount: sc ? S.plannedAmount(sc) : amt,
      earlyCompleted: earlyCompleted,
      originalScheduleDate: sc && earlyCompleted ? sc.originalDate : '',
      originalScheduleTime: sc && earlyCompleted ? S.formatHM(sc.originalStartTime) : ''
    }].concat(student.history || [])
    syncStudentSafe(student)
    var undo = { id: student.id, rb: oldRemaining, lcd: oldLastClassDate, amt: amt, histTs: histTs, scheduleId: scheduleId, walkIn: walkIn, restoreSchedule: !!restoreScheduleOnUndo }
    app.save()
    syncScheduleSafe(changedSchedule)

    this._classSubmitting = false
    if (this._ot) { clearTimeout(this._ot); this._ot = null }
    if (this._lt) { clearTimeout(this._lt); this._lt = null }
    this.setData({ showClass: false, classSchedule: null, classRestoreScheduleOnUndo: false, classScheduleState: '', classTitle: '选择消课节数', classSubmitting: false, showOkT: false, showLowT: false, lowMsg: '', showUndo: true, lastUndo: undo, _openIx: -1 })
    this.reload()
    this.refreshSchedulePopups()
    var newList = this.data.list || []
    var targetItem = null
    for (var k = 0; k < newList.length; k++) { if (newList[k].id == t.id) { targetItem = newList[k]; break } }
    if (targetItem) {
      this.flashCard(newList, targetItem)
    }

    if (this._ut) clearTimeout(this._ut)
    var that = this
    this._ut = setTimeout(function () { that.setData({ showUndo: false, lastUndo: null }) }, 6000)
    var nr = S.parseAmount(oldRemaining, 0) - amt
    if (nr > 0 && nr <= 3) {
      if (that._lt) clearTimeout(that._lt)
      that.setData({ showLowT: true, lowMsg: "该学员剩余" + S.formatAmount(nr) + "节课，记得提醒续费哦～" })
      that._lt = setTimeout(function () { that.setData({ showLowT: false }) }, 2000)
    }
  },

  undoClass: function () {
    var a = this.data.lastUndo; if (!a) return

    A.track('undo')
    var now = Date.now()
    app.globalData.students = app.globalData.students.map(function (s) {
      if (s.id == a.id) {
        var nh = [], rm = false
        for (var i = 0; i < (s.history || []).length; i++) {
          if (!rm && s.history[i].type === U.REC.DEDUCT && (!a.histTs || s.history[i].ts === a.histTs)) { rm = true; continue }
          nh.push(s.history[i])
        }
        s.remainingLessons = a.rb; s.lastClassDate = a.lcd || ''; s.history = nh; s.lastModified = now; s.updatedAt = now
        syncStudentSafe(s)
      }
      return s
    })
    var sc = a.scheduleId !== '' ? S.findById(app.globalData.schedules || [], a.scheduleId) : null
    if (sc) {
      if (a.walkIn || !a.restoreSchedule) {
        sc.status = S.STATUS.DELETED
        sc.deleted = true
        sc.deletedAt = U.today()
        sc.actualAmount = 0
        sc.earlyCompleted = false
        sc.completeNote = ''
        sc.completedAt = 0
        sc.linkedHistoryTs = 0
      } else {
        sc.status = S.STATUS.SCHEDULED
        sc.deleted = false
        sc.deletedAt = ''
        sc.actualAmount = 0
        if (sc.originalDate) {
          sc.date = sc.originalDate
          sc.originalDate = ''
        }
        if (sc.originalStartTime) {
          sc.startTime = sc.originalStartTime
          sc.originalStartTime = ''
        }
        sc.earlyCompleted = false
        sc.completeNote = ''
        sc.completedAt = 0
        sc.linkedHistoryTs = 0
      }
      sc.updatedAt = now
    }
    app.save()
    syncScheduleSafe(sc)

    this.reload()
    var list = this.data.list.slice()
    var undoItem = null
    for (var j = 0; j < list.length; j++) { if (list[j].id == a.id) { undoItem = list[j]; break } }
    this.setData({ showUndo: false, lastUndo: null, list: list, _openIx: -1 })
    if (undoItem) {
      this.flashCard(list, undoItem)
    }
  },

  // ===== 弹窗 =====
  closeExpModal: function () { this.setData({ showExpModal: false }) },
  onTopIco: function () { this.setData({ showFeedback: true, fbContent: '', fbContact: '', fbImgs: [], fbShowMember: !!app.globalData.upgradeShown }) },
  onUpgrade: function () {
    var title = app.globalData.memberExpired || (this.data.isPro && this.data.proExpiry) ? '续费专业版' : '升级专业版'
    this.setData({ showUpg: true, upgradeTitle: title, plan: U.PLAN.MONTHLY })
  },
  closeUpg: function () { this.setData({ showUpg: false, showShareModal: true }) },
  closeShareModal: function () {
    this.setData({ showShareModal: false })
  },

  startSharePoll: function () {
    var that = this
    if (!C.isReady() || this.data._polling) return
    this.data._polling = true
    // 等openid就位后开始轮询
    var startPoll = function () {
      if (!app.globalData._realOpenid) {
        if (that._rewardOpenidTimer) clearTimeout(that._rewardOpenidTimer)
        that._rewardOpenidTimer = setTimeout(function () {
          that._rewardOpenidTimer = null
          startPoll()
        }, 500)
        return
      }
      var count = 0
      var check = function () {
        if (count >= 6) { that.data._polling = false; return }
        count++
        C.pullMember(function (isPro, expired, proExp, welcomeDays, pendingDays) {
          if (pendingDays > 0) {
            that.data._polling = false
            app.globalData.isProMember = !!isPro
            app.globalData.memberExpired = !!expired
            app.globalData.proExpiry = proExp || ''
            app.globalData.upgradeShown = true; app.save()
            C.clearRewardFlags()
            that.setData({
              showRewardModal: true, rewardTitle: '恭喜你！', rewardDays: pendingDays, rewardType: 'share',
              isPro: true, proExpiry: proExp || ''
            })
          } else {
            if (that._rewardCheckTimer) clearTimeout(that._rewardCheckTimer)
            that._rewardCheckTimer = setTimeout(function () {
              that._rewardCheckTimer = null
              check()
            }, 10000)
          }
        })
      }
      if (that._rewardCheckTimer) clearTimeout(that._rewardCheckTimer)
      that._rewardCheckTimer = setTimeout(function () {
        that._rewardCheckTimer = null
        check()
      }, 10000)
    }
    startPoll()
  },
  closeRewardModal: function () { this.setData({ showRewardModal: false }) },
  closeMonthlyReport: function () { this.setData({ showMonthlyReport: false }) },
  previewMonthlyReport: function () {
    var img = this.data.monthlyReportImg
    if (!img) return
    wx.previewImage({ current: img, urls: [img] })
  },
  saveMonthlyReport: function () {
    var img = this.data.monthlyReportImg
    if (!img) { this.showOkText('海报生成中'); return }
    var that = this
    wx.saveImageToPhotosAlbum({
      filePath: img,
      success: function () { that.showOkText('已保存') },
      fail: function () { that.showOkText('保存失败，请检查相册权限') }
    })
  },
  shareMonthlyReport: function () {
    var img = this.data.monthlyReportImg
    if (!img) { this.showOkText('海报生成中'); return }
    if (wx.showShareImageMenu) {
      wx.showShareImageMenu({
        path: img,
        fail: function () { wx.previewImage({ current: img, urls: [img] }) }
      })
    } else {
      wx.previewImage({ current: img, urls: [img] })
    }
  },
  closeFeedback: function () { this.setData({ showFeedback: false, showFbPreview: false, fbPreviewSrc: '' }) },
  onFbUpgrade: function () {
    var title = app.globalData.memberExpired || (this.data.isPro && this.data.proExpiry) ? '续费专业版' : '升级专业版'
    this.setData({ showFeedback: false, showUpg: true, upgradeTitle: title, plan: U.PLAN.MONTHLY })
  },
  onFbContent: function (e) { this.setData({ fbContent: e.detail.value }) },
  onFbContact: function (e) { this.setData({ fbContact: e.detail.value }) },
  onFbAddImg: function () {
    var that = this
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'],
      success: function (res) {
        var imgs = that.data.fbImgs || []
        if (imgs.length >= 3) return
        var f = res.tempFiles[0]
        if (f.size > 2 * 1024 * 1024) { wx.showToast({ title: '图片不能超过2MB', icon: 'none', duration: 2000 }); return }
        imgs.push(f.tempFilePath)
        that.setData({ fbImgs: imgs })
      }
    })
  },
  onFbImgDel: function (e) {
    var ix = parseInt(e.currentTarget.dataset.ix)
    var imgs = this.data.fbImgs.slice()
    imgs.splice(ix, 1)
    this.setData({ fbImgs: imgs })
  },

  onFbImg: function (e) {
    var ix = parseInt(e.currentTarget.dataset.ix)
    var imgs = this.data.fbImgs || []
    if (!imgs[ix]) return
    this.setData({ showFbPreview: true, fbPreviewSrc: imgs[ix] })
  },

  closeFbPreview: function () {
    this.setData({ showFbPreview: false, fbPreviewSrc: '' })
  },

  submitFeedback: function () {
    if (this.data.feedbackSubmitting) return
    var that = this
    var content = (this.data.fbContent || '').trim()
    var contact = (this.data.fbContact || '').trim()
    if (!content) { wx.showToast({ title: '请输入反馈内容', icon: 'none', duration: 2000 }); return }
    this.setData({ feedbackSubmitting: true })
    if (C.isReady()) {
      // 先上传图片到云存储
      var imgs = this.data.fbImgs || []
      var uploadImg = function (idx, urls, cb) {
        if (idx >= imgs.length) { cb(urls); return }
        wx.cloud.uploadFile({
          cloudPath: 'feedback/' + Date.now() + '_' + idx + '.jpg',
          filePath: imgs[idx],
          success: function (res) { urls.push(res.fileID); uploadImg(idx + 1, urls, cb) },
          fail: function () { uploadImg(idx + 1, urls, cb) }
        })
      }
      uploadImg(0, [], function (urls) {
        C.submitFeedback(content, contact, urls, function (err) {
          if (err) {
            that.setData({ feedbackSubmitting: false })
            wx.showToast({ title: '提交失败，请重试', icon: 'none', duration: 2000 })
          } else {
            that.setData({ showFeedback: false, fbImgs: [], feedbackSubmitting: false })
            wx.showToast({ title: '感谢反馈！', icon: 'success', duration: 2000 })
          }
        })
      })
    } else {
      wx.setClipboardData({
        data: '反馈：' + content + (contact ? '\n联系方式：' + contact : ''),
        success: function () {
          that.setData({ showFeedback: false, feedbackSubmitting: false })
          wx.showToast({ title: '已复制，请粘贴发送给开发者', icon: 'none', duration: 2500 })
        },
        fail: function () {
          that.setData({ feedbackSubmitting: false })
          wx.showToast({ title: '提交失败，请重试', icon: 'none', duration: 2000 })
        }
      })
    }
  },
  onPlan: function (e) { this.setData({ plan: e.currentTarget.dataset.plan }) },
  doUpg: function () {
    if (this.data.paying) return
    var that = this, plan = this.data.plan
    if (!C.isReady()) {
      wx.showToast({ title: '支付功能即将上线', icon: 'none', duration: 2000 })
      this.setData({ showUpg: false })
      return
    }
    this.setData({ paying: true })
    wx.showLoading({ title: '处理中...', mask: true })
    C.pay(plan, function (err, payResult) {
      wx.hideLoading()
      that.setData({ paying: false })
      if (err) {
        if (err !== 'pay_cancel') { wx.showToast({ title: '支付失败，请重试', icon: 'none', duration: 2000 }) }
      } else {
        app.globalData.isProMember = true
        app.globalData.memberExpired = false
        if (payResult && payResult.proExpiry !== undefined) {
          app.globalData.proExpiry = payResult.proExpiry || ''
        } else {
          var baseExpiry = app.globalData.proExpiry && app.globalData.proExpiry > U.today() ? app.globalData.proExpiry : U.today()
          app.globalData.proExpiry = plan === U.PLAN.LIFETIME ? '' : U.addMonths(baseExpiry, 1)
        }
        app.save()
        that.setData({ showUpg: false, isPro: true, showMember: false, proExpiry: app.globalData.proExpiry })
        wx.showToast({ title: '升级成功！', icon: 'success', duration: 2000 })
      }
    })
  },
  clearToastTimers: function () {
    if (this._ut) { clearTimeout(this._ut); this._ut = null }
    if (this._lt) { clearTimeout(this._lt); this._lt = null }
    if (this._ot) { clearTimeout(this._ot); this._ot = null }
  },
  clearPageTimers: function () {
    this.clearToastTimers()
    this.clearStatusRefreshTimer()
    if (this._searchTimer) { clearTimeout(this._searchTimer); this._searchTimer = null }
    if (this._stt) { clearTimeout(this._stt); this._stt = null }
    if (this._listMeasureTimer) { clearTimeout(this._listMeasureTimer); this._listMeasureTimer = null }
    if (this._scheduleEditCloseTimer) { clearTimeout(this._scheduleEditCloseTimer); this._scheduleEditCloseTimer = null }
    if (this._scheduleEditResetTimer) { clearTimeout(this._scheduleEditResetTimer); this._scheduleEditResetTimer = null }
    if (this._scheduleEditShakeTimer1) { clearTimeout(this._scheduleEditShakeTimer1); this._scheduleEditShakeTimer1 = null }
    if (this._scheduleEditShakeTimer2) { clearTimeout(this._scheduleEditShakeTimer2); this._scheduleEditShakeTimer2 = null }
    if (this._cardTapTimer) { clearTimeout(this._cardTapTimer); this._cardTapTimer = null }
    if (this._swipeHintTimer1) { clearTimeout(this._swipeHintTimer1); this._swipeHintTimer1 = null }
    if (this._swipeHintTimer2) { clearTimeout(this._swipeHintTimer2); this._swipeHintTimer2 = null }
    if (this._easterToastTimer) { clearTimeout(this._easterToastTimer); this._easterToastTimer = null }
    if (this._rewardOpenidTimer) { clearTimeout(this._rewardOpenidTimer); this._rewardOpenidTimer = null }
    if (this._rewardCheckTimer) { clearTimeout(this._rewardCheckTimer); this._rewardCheckTimer = null }
    if (this._guideTapTimer) { clearTimeout(this._guideTapTimer); this._guideTapTimer = null }
    if (this._refreshTimer) { clearTimeout(this._refreshTimer); this._refreshTimer = null }
    if (this._refreshWaitTimer) { clearTimeout(this._refreshWaitTimer); this._refreshWaitTimer = null }
    if (this._monthlyReportTimer) { clearTimeout(this._monthlyReportTimer); this._monthlyReportTimer = null }
    if (this._monthlyReportRetryTimer) { clearTimeout(this._monthlyReportRetryTimer); this._monthlyReportRetryTimer = null }
  },
  showOkText: function (text) {
    var that = this
    if (that._ot) clearTimeout(that._ot)
    that.setData({
      showUndo: false,
      lastUndo: null,
      showLowT: false,
      lowMsg: '',
      showOkT: true,
      okMsg: text || '操作成功'
    })
    that._ot = setTimeout(function () { that.setData({ showOkT: false }) }, 1600)
  },
  showOk: function () {
    var that = this
    if (that._ut) { clearTimeout(that._ut); that._ut = null }
    if (that._lt) { clearTimeout(that._lt); that._lt = null }
    if (that._ot) clearTimeout(that._ot)
    that.setData({
      showUndo: false,
      lastUndo: null,
      showLowT: false,
      lowMsg: '',
      showOkT: true,
      okMsg: '操作成功'
    })
    that._ot = setTimeout(function () { that.setData({ showOkT: false }) }, 2000)
  },

  // ===== 历史 =====
  formatHistoryTime: function (rec) {
    rec = rec || {}
    var raw = rec && rec.time ? String(rec.time) : ''
    var dateText = ''
    var timeText = ''
    var pad2 = function (n) {
      n = String(n || '')
      return n.length < 2 ? '0' + n : n
    }
    var m = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:\s+(\d{1,2}:\d{2}))?/)
    if (m) {
      dateText = m[1] + '/' + pad2(m[2]) + '/' + pad2(m[3])
      timeText = m[4] ? m[4] : ''
    } else if (rec && rec.ts) {
      var d = new Date(rec.ts)
      if (!isNaN(d.getTime())) {
        dateText = d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate())
        timeText = pad2(d.getHours()) + ':' + pad2(d.getMinutes())
      }
    }
    if (!dateText && raw) {
      var parts = raw.split(/\s+/)
      dateText = (parts[0] || raw).replace(/-/g, '/')
      timeText = parts[1] || ''
    }
    var out = {}
    for (var key in rec) {
      if (Object.prototype.hasOwnProperty.call(rec, key)) out[key] = rec[key]
    }
    out.dateText = dateText
    out.timeText = timeText
    return out
  },

  onHist: function (e) {
    var id = e.currentTarget.dataset.id, s = this.getById(id)
    if (!s) return
    var that = this
    var recs = (s.history || []).slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0) }).map(function (rec) {
      return that.formatHistoryTime(rec)
    })
    var data = {
      showHist: true,
      histData: { name: s.name, remaining: s.remainingLessons, emoji: s.avatarSrc || '/images/avatars/avatar_1.png', records: recs }
    }
    var ix = this.data._openIx, list = this.data.list
    if (ix >= 0 && list[ix]) {
      list[ix].open = false; list[ix]._sx = 0; list[ix]._st = false
      data.list = list; data._openIx = -1
    }
    this.setData(data)
  },

  closeHist: function () { this.setData({ showHist: false }) },

  onTapBlank: function () { this.closeAll() },

  scrollToTop: function () {
    var that = this
    that.setData({ scrollTop: 1 })
    if (that._stt) clearTimeout(that._stt)
    that._stt = setTimeout(function () { that.setData({ scrollTop: 0 }) }, 100)
  },

  scrollToBot: function () {
    var that = this
    that.setData({ scrollTop: 99999 })
  },

  flashCard: function (list, item) {
    if (!list || !list.length || !item) return
    var that = this
    // 确定光环颜色：正常=绿，低课时=红，过期=绿
    var hlClass = item.low ? 'card-hl-red' : 'card-hl-green'
    item.highlight = hlClass
    that.setData({ list: list.slice() })
    setTimeout(function () {
      item.highlight = ''
      that.setData({ list: list.slice() })
    }, 500)
  },

  _debugOffset: 0,

  debugTD: function () {
    var d = new Date(); d.setDate(d.getDate() + this._debugOffset)
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)
  },

  refreshDebugInfo: function () {
    var today = this.debugTD()
    var info = prevMonthInfo(today)
    this.setData({ debugTodayText: today, debugReportMonthText: info.monthText })
  },

  onDebug: function () {
    this.setData({ showDebug: true, debugOffset: this._debugOffset })
    this.refreshDebugInfo()
  },
  closeDebug: function () {
    var that = this
    this.setData({ showDebug: false, showDebugClearConfirm: false }, function () {
      that.queueMonthlyReportCheck()
    })
  },

  setDebugOffset: function (e) {
    var v = parseInt(e.currentTarget.dataset.v); this._debugOffset = v
    this.setData({ debugOffset: v }); this.refreshDebugInfo(); this.reload()
  },

  setDebugReportDay: function (e) {
    var day = parseInt(e.currentTarget.dataset.day)
    if (!day || day < 1 || day > 3) return
    var now = new Date()
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    var target = new Date(now.getFullYear(), now.getMonth() + 1, day)
    this.showDebugMonthlyReport(target, false)
  },

  setDebugDecemberReport: function () {
    this.showDebugMonthlyReport(new Date(2027, 0, 1), true)
  },

  showDebugMonthlyReport: function (target, allowEmpty) {
    var now = new Date()
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    var offset = Math.round((target.getTime() - today.getTime()) / 86400000)
    var targetDate = target.getFullYear() + '-' + U.p2(target.getMonth() + 1) + '-' + U.p2(target.getDate())
    var info = prevMonthInfo(targetDate)
    var report = this.buildMonthlyReportData(info)
    if (!report || (report.totalLessonsRaw <= 0 && !allowEmpty)) {
      this.showOkText('这个月还没有消课记录')
      return
    }
    var that = this
    this._debugOffset = offset
    wx.removeStorageSync('monthly_report_seen_' + info.key)
    this.setData({
      debugOffset: offset,
      showDebug: false,
      showDebugClearConfirm: false,
      showMonthlyReport: false,
      monthlyReportGenerating: true,
      monthlyReportData: report,
      monthlyReportImg: ''
    }, function () {
      that.refreshDebugInfo()
      that.drawMonthlyReport(report, function (path) {
        if (!path) {
          that.setData({ monthlyReportGenerating: false })
          that.showOkText('海报生成失败')
          return
        }
        that.setData({
          showMonthlyReport: true,
          monthlyReportImg: path,
          monthlyReportGenerating: false
        })
      })
    })
  },

  clearMonthlyReportSeen: function () {
    this.clearMonthlyReportSeenForDebug(true)
  },

  clearMonthlyReportSeenForDebug: function (shouldReload) {
    var info = prevMonthInfo(this.debugTD())
    wx.removeStorageSync('monthly_report_seen_' + info.key)
    this.setData({ showMonthlyReport: false, monthlyReportImg: '' })
    if (shouldReload) {
      this.reload()
      this.showOkText('已重置月报弹窗')
    }
  },

  setDebugExp: function (e) {
    var v = parseInt(e.currentTarget.dataset.v)
    this.setData({ debugExpDays: v })
    var ss = app.globalData.students
    if (v !== 0 && ss.length > 0) {
      var td = this.debugTD(), target = new Date(td)
      target.setDate(target.getDate() + v)
      var ds = target.getFullYear() + '-' + ('0' + (target.getMonth() + 1)).slice(-2) + '-' + ('0' + target.getDate()).slice(-2)
      // 更新所有活跃学员的有效期
      for (var i = 0; i < ss.length; i++) { if (!ss[i].deleted) { ss[i].expiryDate = ds } }
      app.save(); this.reload()
    }
  },

  setDebugMember: function (e) {
    var v = parseInt(e.currentTarget.dataset.v)
    app.globalData.isProMember = (v === 2 || v === 3)
    app.globalData.memberExpired = (v === 1)
    if (v === 3) {
      var d = new Date(); d.setDate(d.getDate() + 5)
      app.globalData.proExpiry = d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2)
    } else if (v === 2) {
      app.globalData.proExpiry = U.addMonths(U.today(), 1)
    } else {
      app.globalData.proExpiry = ''
    }
    app.save(); this.setData({ debugMember: v }); this.reload()
  },

  resetDebug: function () {
    this._debugOffset = 0; app.globalData.memberExpired = false; app.globalData.isProMember = false; app.globalData.proExpiry = ''; app.globalData.swipeHintDismissed = false
    app.globalData.bannerDismissedToday = { date: U.today(), sleepy: false, expiry: false, memberExpired: false }
    this.setData({ debugOffset: 0, debugExpDays: 0, debugMember: 0 })
    this.refreshDebugInfo()
    // 恢复原始有效期（默认6个月后）
    var ss = app.globalData.students, td = U.today()
    for (var i = 0; i < ss.length; i++) {
      if (!ss[i].deleted) { ss[i].expiryDate = U.addMonths(td, 6) }
    }
    app.save(); this.reload()
  },

  testWelcome: function () { this.setData({ showRewardModal: true, rewardTitle: '恭喜你！', rewardDays: 15, rewardType: 'welcome' }) },
  testReward: function () { this.setData({ showRewardModal: true, rewardTitle: '恭喜你！', rewardDays: 15, rewardType: 'share' }) },

  clearAllData: function () {
    this.setData({ showDebugClearConfirm: true })
  },

  closeDebugClearConfirm: function () {
    this.setData({ showDebugClearConfirm: false })
  },

  doClearAllData: function () {
    app.globalData.students = []; app.globalData.nextId = 0
    app.globalData.schedules = []; app.globalData.nextScheduleId = 0
    app.globalData.memberExpired = false; app.globalData.isProMember = false; app.globalData.proExpiry = ''; app.globalData.swipeHintDismissed = false
    app.globalData.bannerDismissedToday = {}
    app.globalData.welcomeReward = 0; app.globalData.pendingReward = 0
    wx.removeStorageSync('_easter_egg_claimed')
    app.globalData.upgradeShown = false
    wx.removeStorageSync('_pending_easter_sync')
    wx.removeStorageSync('_analytics')
    wx.removeStorageSync('_offline_queue')
    app.save(); this._debugOffset = 0
    this.setData({ showDebugClearConfirm: false, showDebug: false, debugOffset: 0, debugExpDays: 0, debugMember: 0, debugTodayText: '', debugReportMonthText: '' })
    this.reload()
  },

  nop: function () { }
})
