var app = getApp()
var U = require('../../utils/util.js')
var C = require('../../utils/cloud.js')
var A = require('../../utils/analytics.js')
var AVATARS = []
for (var ai = 1; ai <= 40; ai++) { AVATARS.push('/images/avatars/avatar_' + ai + '.png') }
function rem() { return AVATARS[Math.floor(Math.random() * AVATARS.length)] }

Page({
  data: {
    sbh: 20, empty: true, students: [], list: [], keyword: '',
    showSleepy: false, sleepyName: '',
    showExpiry: false, expiryName: '', expiryDay: 0,
    showMember: false,
    showClass: false, classTarget: {}, classAmount: 1,
    showForm: false, editing: false, editId: 0, nameFocus: false,
    fd: { avatarSrc: '/images/avatars/avatar_1.png', name: '', totalLessons: 24, expiryDate: '', note: '' },
    showDel: false, delTarget: {},
    showHist: false, histData: { name: '', remaining: 0, emoji: '🐯', records: [] },
    showExpModal: false,
    showUpg: false, plan: U.PLAN.YEARLY,
    showUndo: false, lastUndo: null,
    showLowT: false, lowMsg: '',
    showOkT: false, okMsg: '操作成功', showHintT: false,
    showEasterT: false, showEasterEgg: false, easterClaimed: false, confetti: [],
    showFeedback: false, fbContent: '', fbContact: '', fbImgs: [],
    fbShowMember: false, showShareModal: false,
    showRewardModal: false, rewardTitle: '', rewardSub: '', rewardDays: 0, rewardType: '',
    isPro: false, proExpiry: '', proExpSoon: false, activeCnt: 0, scrollTop: 0, kbH: 0, scrollY: true, botPad: 20,
    showDebug: false, debugOffset: 0, debugExpDays: 0, debugMember: 0,
    icoTop: 0, icoLeft: 0, icoSize: 32, icoRadius: 16,
    _tsX: 0, _tsY: 0, _openIx: -1, _swipeIx: -1, _locked: false
  },

  _searchTimer: null,
  _guideTapCount: 0,
  _guideTapTimer: null,

  onShareAppMessage: function () {
    return {
      title: '教练消课宝——独立教练的消课管理工具',
      path: '/pages/index/index?ref=' + (app.globalData.openid || '')
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
    wx.onKeyboardHeightChange(function (res) { that.setData({ kbH: res.height }) })
    this.reload()
  },

  onShow: function () {
    var that = this
    C.checkNetwork()
    if (C.isOnline()) {
      C.flushQueue()
      // 补上离线时未同步的彩蛋标记
      if (wx.getStorageSync('_pending_easter_sync') && C.isReady()) {
        C.syncEasterClaimed()
        wx.removeStorageSync('_pending_easter_sync')
      }
    }
    this.reload()
    // 后台查分享奖励，有就弹窗
    if (C.isReady()) {
      C.pullMember(function (isPro, expired, proExp, welcomeDays, pendingDays) {
        if (welcomeDays > 0) {
          app.globalData.isProMember = !!isPro
          app.globalData.memberExpired = !!expired
          app.globalData.proExpiry = proExp || ''
          C.clearRewardFlags()
          app.globalData.upgradeShown = true; app.save()
          that.setData({ showRewardModal: true, rewardTitle: '恭喜你！', rewardSub: '通过分享获得专业版会员！', rewardDays: welcomeDays })
        } else if (pendingDays > 0) {
          app.globalData.isProMember = !!isPro
          app.globalData.memberExpired = !!expired
          app.globalData.proExpiry = proExp || ''
          C.clearRewardFlags()
          app.globalData.upgradeShown = true; app.save()
          that.setData({ showRewardModal: true, rewardTitle: '恭喜你！', rewardSub: '分享成功，你获得了' + pendingDays + '天会员，继续分享可获得更多会员时长！' })
        }
      })
    }
  },

  onHide: function () {
    if (this._ut) { clearTimeout(this._ut); this._ut = null }
    if (this._lt) { clearTimeout(this._lt); this._lt = null }
    if (this._ot) { clearTimeout(this._ot); this._ot = null }
    if (this._stt) { clearTimeout(this._stt); this._stt = null }
  },

  onUnload: function () {
    if (this._ut) clearTimeout(this._ut)
    if (this._lt) clearTimeout(this._lt)
    if (this._ot) clearTimeout(this._ot)
    if (this._searchTimer) clearTimeout(this._searchTimer)
    if (this._stt) clearTimeout(this._stt)
  },

  reload: function () {
    var ss = app.globalData.students || []
    var pro = app.globalData.isProMember && !app.globalData.memberExpired
    // 检查Pro到期：如果到期日已过，自动标记过期
    if (app.globalData.proExpiry && U.today() >= app.globalData.proExpiry) {
      app.globalData.memberExpired = true
      app.globalData.proExpiry = ''
      app.save()
      pro = false
    }
    var bd = app.globalData.bannerDismissedToday || {}
    var td = this.debugTD()

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
      var item = {
        id: s.id, name: s.name, avatarSrc: s.avatarSrc || '/images/avatars/avatar_1.png',
        note: s.note || '', remainingLessons: s.remainingLessons,
        expiryDate: s.expiryDate, lastClassDate: s.lastClassDate,
        lastModified: s.lastModified || 0, exp: U.isExp(s), low: !U.isExp(s) && s.remainingLessons <= 3 && s.remainingLessons > 0,
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
      if (a.exp !== b.exp) return a.exp ? 1 : -1
      return (b.lastModified || 0) - (a.lastModified || 0)
    })

    var expSoon = pro && app.globalData.proExpiry && U.daysBetween(td, app.globalData.proExpiry) <= 7
    this.setData({
      students: ss.slice(), isPro: pro, proExpiry: app.globalData.proExpiry || '', proExpSoon: expSoon,
      showSleepy: sl, sleepyName: sn,
      showExpiry: ex, expiryName: en, expiryDay: ed,
      showMember: mb,
      activeCnt: ac, empty: ac === 0,
      list: r.slice(), _openIx: -1
    })
    // 分享奖励弹窗
    if (app.globalData.welcomeReward > 0) {
      var d = app.globalData.welcomeReward
      app.globalData.welcomeReward = 0
      app.globalData.upgradeShown = true; app.save()
      this.setData({ showRewardModal: true, rewardTitle: '恭喜你！', rewardDays: d, rewardType: 'welcome' })
      if (C.isReady()) C.clearRewardFlags()
    } else if (app.globalData.pendingReward > 0) {
      var days = app.globalData.pendingReward
      app.globalData.pendingReward = 0
      app.globalData.upgradeShown = true; app.save()
      this.setData({ showRewardModal: true, rewardTitle: '恭喜你！', rewardDays: days, rewardType: 'share' })
      if (C.isReady()) C.clearRewardFlags()
    }
  },

  getById: function (id) {
    var ss = app.globalData.students || []
    for (var i = 0; i < ss.length; i++) { if (ss[i].id == id) return ss[i] }
    return null
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


  // ===== 左滑 =====
  ts: function (e) {
    this.data._tsX = e.touches[0].clientX
    this.data._tsY = e.touches[0].clientY
    this.data._locked = false
  },

  tm: function (e) {
    var dx = e.touches[0].clientX - this.data._tsX
    var dy = e.touches[0].clientY - this.data._tsY
    if (this.data._locked) {
      var ix = this.data._swipeIx
      var list = this.data.list
      if (!list[ix]) return
      var cur = list[ix]._sx || 0, nx = cur + dx
      if (nx > 0) nx = 0; if (nx < -420) nx = -420
      list[ix]._sx = nx; list[ix]._st = false
      this.setData({ list: list, scrollY: false })
      this.data._tsX = e.touches[0].clientX
    } else if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      this.data._locked = true
      this.data._swipeIx = e.currentTarget.dataset.ix
      this.setData({ scrollY: false })
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
  openIt: function (ix) { var list = this.data.list; if (!list[ix]) return; list[ix].open = true; list[ix]._sx = 0; list[ix]._st = true; this.setData({ list: list, _openIx: ix }) },
  closeIt: function (ix) { var list = this.data.list; if (ix < 0 || !list[ix]) return; list[ix].open = false; list[ix]._sx = 0; list[ix]._st = true; this.setData({ list: list, _openIx: -1 }) },
  closeAll: function () { var l = this.data.list, i = this.data._openIx; if (i >= 0 && l[i]) { l[i].open = false; l[i]._sx = 0; l[i]._st = true; this.setData({ list: l, _openIx: -1 }) } },
  onScroll: function () { if (this.data._openIx >= 0) this.closeAll() },

  onCardTap: function (e) {
    var ix = parseInt(e.currentTarget.dataset.ix), id = e.currentTarget.dataset.id
    var oldIx = this.data._openIx
    if (oldIx !== -1) {
      this.closeIt(oldIx)
      if (oldIx !== ix) {
        var s = this.getById(id); if (!s) return
        if (U.isExp(s)) { this.setData({ showExpModal: true }) } else { this.setData({ showClass: true, classTarget: s, classAmount: 1 }) }
      }
      return
    }
    var s = this.getById(id); if (!s) return
    if (U.isExp(s)) { this.setData({ showExpModal: true }) } else { this.setData({ showClass: true, classTarget: s, classAmount: 1 }) }
  },

  // ===== 横幅 =====
  dismissSleepy: function () { app.globalData.bannerDismissedToday.sleepy = true; app.save(); this.setData({ showSleepy: false }) },
  dismissExpiry: function () { app.globalData.bannerDismissedToday.expiry = true; app.save(); this.setData({ showExpiry: false }) },
  dismissMember: function () { app.globalData.bannerDismissedToday.memberExpired = true; app.save(); this.setData({ showMember: false }) },

  // ===== 添加 =====
  onAddTap: function () {
    this.closeAll()
    var pro = this.data.isPro && !app.globalData.memberExpired, cnt = this.data.activeCnt
    if (!pro && cnt >= 8) { A.track('upgrade_show'); app.globalData.upgradeShown = true; app.save(); this.setData({ showUpg: true, plan: U.PLAN.YEARLY }); return }
    this.onAdd()
  },

  onAdd: function () {
    this.setData({
      showForm: true, editing: false, nameFocus: true,
      fd: { avatarSrc: rem(), name: '', totalLessons: 24, expiryDate: U.addMonths(U.today(), 6), note: '' }
    })
  },

  closeForm: function () { this.setData({ showForm: false, editing: false, nameFocus: false }) },
  randAv: function () { this.setData({ 'fd.avatarSrc': rem() }) },
  onFdName: function (e) { this.setData({ 'fd.name': e.detail.value }) },
  onFdLessons: function (e) { this.setData({ 'fd.totalLessons': parseInt(e.detail.value) || 0 }) },
  onQuick: function (e) { this.setData({ 'fd.totalLessons': parseInt(e.currentTarget.dataset.v) }) },
  onFdDate: function (e) { this.setData({ 'fd.expiryDate': e.detail.value }) },
  onFdNote: function (e) { this.setData({ 'fd.note': e.detail.value }) },

  onEdit: function (e) {
    var id = e.currentTarget.dataset.id, s = this.getById(id); if (!s) return
    this.closeAll()
    this.setData({
      showForm: true, editing: true, editId: id, nameFocus: false,
      fd: { avatarSrc: s.avatarSrc || '/images/avatars/avatar_1.png', name: s.name, totalLessons: s.remainingLessons, expiryDate: s.expiryDate || '', note: s.note || '' }
    })
  },

  submitForm: function () {
    var fd = this.data.fd
    if (!fd.name || !fd.name.trim()) { wx.showToast({ title: '请输入学员姓名', icon: 'none', duration: 2000 }); return }
    if (!fd.totalLessons || fd.totalLessons <= 0) { wx.showToast({ title: '请输入课时数', icon: 'none', duration: 2000 }); return }
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
    A.track(wasEditing ? 'student_edit' : 'student_add')
    // 云端同步新/编辑的学员
    if (C.isReady()) {
      var synced = wasEditing ? ss.filter(function (s) { return s.id == editId })[0] : ss[ss.length - 1]
      if (synced) C.syncStudent(synced)
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
      // 首次添加学员：1秒后触发左滑提示动画
      if (this.data.activeCnt === 1) this.showSwipeHint()
    }
  },

  showSwipeHint: function () {
    var that = this
    setTimeout(function () {
      that.setData({ showHintT: true })
      setTimeout(function () {
        that.setData({ showHintT: false })
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
        // 防滥用：只有未领取过才给会员
        that.setData({ showEasterEgg: true, easterClaimed: !!claimed, confetti: that.makeConfetti() })
        try { wx.vibrateShort({ type: 'medium' }) } catch (e) {}
        return
      }
      // 首次双击 → 弹出神秘文案
      this.setData({ showEasterT: true })
      this._guideTapCount = 0
      setTimeout(function () { that.setData({ showEasterT: false }) }, 1000)
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
      app.globalData.upgradeShown = true; app.save()
      var base = app.globalData.proExpiry && app.globalData.proExpiry > U.today() ? app.globalData.proExpiry : U.today()
      var exp = U.addMonths(base, 1)
      app.globalData.isProMember = true
      app.globalData.memberExpired = false
      app.globalData.proExpiry = exp
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
  onDel: function (e) { var id = e.currentTarget.dataset.id, s = this.getById(id); if (!s) return; this.closeAll(); this.setData({ showDel: true, delTarget: s }) },
  closeDel: function () { this.setData({ showDel: false }) },
  doDel: function () {
    var tid = this.data.delTarget.id
    app.globalData.students = app.globalData.students.map(function (s) {
      if (s.id == tid) { s.deleted = true; s.deletedAt = U.today(); if (C.isReady()) C.syncStudent(s) }
      return s
    })
    app.save(); this.setData({ showDel: false })
    A.track('student_delete')
    var hasActive = false, ss = app.globalData.students
    for (var i = 0; i < ss.length; i++) { if (!ss[i].deleted) { hasActive = true; break } }
    if (hasActive) this.showOk()
    this.reload()
  },

  // ===== 消课 =====
  closeClass: function () { this.setData({ showClass: false }) },
	  onClassQuick: function (e) { this.setData({ classAmount: parseInt(e.currentTarget.dataset.v) || 1 }) },
  doClass: function () {
    var that = this, t = this.data.classTarget, td = U.today(), tm = U.formatTime(), amt = this.data.classAmount || 1
    A.track('deduct', { amount: amt, studentId: t.id })
    var online = C.isOnline()
    that.data.lastUndo = { id: t.id, rb: t.remainingLessons, lcd: t.lastClassDate, amt: amt }

    app.globalData.students = app.globalData.students.map(function (s) {
      if (s.id == t.id) {
        s.remainingLessons = Math.max(0, s.remainingLessons - amt); s.lastClassDate = td; s.lastModified = Date.now()
        s.history = [{ type: U.REC.DEDUCT, amount: amt, time: td + " " + tm, ts: Date.now() }].concat(s.history || [])
        // 云端同步（在线时同步，离线时入队）
        if (C.isReady()) {
          if (online) { C.syncStudent(s) } else { C.queueOp('save', s) }
        }
      }
      return s
    })
    app.save()

    var ss = app.globalData.students, newList = []
    for (var i = 0; i < ss.length; i++) {
      var s = ss[i]
      if (s.deleted) continue
      newList.push({
        id: s.id, name: s.name, avatarSrc: s.avatarSrc || '/images/avatars/avatar_1.png',
        note: s.note || "", remainingLessons: s.remainingLessons,
        expiryDate: s.expiryDate, lastClassDate: s.lastClassDate,
        lastModified: s.lastModified || 0, exp: U.isExp(s), low: !U.isExp(s) && s.remainingLessons <= 3 && s.remainingLessons > 0,
        open: false
      })
    }
    var kw = (that.data.keyword || '').trim().toLowerCase()
    if (kw) { newList = newList.filter(function (x) { return x.name.toLowerCase().indexOf(kw) !== -1 }) }
    newList.sort(function (a, b) {
      if (a.exp !== b.exp) return a.exp ? 1 : -1
      return (b.lastModified || 0) - (a.lastModified || 0)
    })

    var targetItem = null
    for (var k = 0; k < newList.length; k++) { if (newList[k].id == t.id) { targetItem = newList[k]; break } }
    that.setData({ showClass: false, list: newList, showUndo: true, _openIx: -1 })
    if (targetItem) {
      if (targetItem.exp) { that.scrollToBot() } else { that.scrollToTop() }
      that.flashCard(newList, targetItem)
    }

    if (that._ut) clearTimeout(that._ut)
    that._ut = setTimeout(function () { that.setData({ showUndo: false, lastUndo: null }) }, 6000)
    var nr = that.data.lastUndo.rb - amt
    if (nr === 3 || nr === 1) {
      that.setData({ showLowT: true, lowMsg: "该学员剩余" + nr + "节课，记得提醒续费哦～" })
      that._lt = setTimeout(function () { that.setData({ showLowT: false }) }, 2000)
    }
  },

  undoClass: function () {
    var a = this.data.lastUndo; if (!a) return

    A.track('undo')
    app.globalData.students = app.globalData.students.map(function (s) {
      if (s.id == a.id) {
        var nh = [], rm = false
        for (var i = 0; i < (s.history || []).length; i++) {
          if (!rm && s.history[i].type === U.REC.DEDUCT) { rm = true; continue }
          nh.push(s.history[i])
        }
        s.remainingLessons = a.rb; s.lastClassDate = a.lcd || s.lastClassDate; s.history = nh; s.lastModified = Date.now()
        if (C.isReady()) C.syncStudent(s)
      }
      return s
    })
    app.save()

    var list = this.data.list.slice()
    for (var i = 0; i < list.length; i++) {
      if (list[i].id == a.id) {
        list[i].remainingLessons = a.rb
        list[i].lastModified = Date.now()
        list[i].exp = U.isExp(list[i])
        list[i].low = !list[i].exp && list[i].remainingLessons <= 3 && list[i].remainingLessons > 0
        break
      }
    }
    list.sort(function (x, y) {
      if (x.exp !== y.exp) return x.exp ? 1 : -1
      return (y.lastModified || 0) - (x.lastModified || 0)
    })

    var undoItem = null
    for (var j = 0; j < list.length; j++) { if (list[j].id == a.id) { undoItem = list[j]; break } }
    this.setData({ showUndo: false, lastUndo: null, list: list, _openIx: -1 })
    if (undoItem) {
      if (undoItem.exp) { this.scrollToBot() } else { this.scrollToTop() }
      this.flashCard(list, undoItem)
    }
  },

  // ===== 弹窗 =====
  closeExpModal: function () { this.setData({ showExpModal: false }) },
  onTopIco: function () { this.setData({ showFeedback: true, fbContent: '', fbContact: '', fbImgs: [], fbShowMember: !!app.globalData.upgradeShown }) },
  onUpgrade: function () { this.setData({ showUpg: true, plan: U.PLAN.YEARLY }) },
  closeUpg: function () { this.setData({ showUpg: false, showShareModal: true }) },
  closeShareModal: function () { this.setData({ showShareModal: false }) },
  closeRewardModal: function () { this.setData({ showRewardModal: false }) },
  closeFeedback: function () { this.setData({ showFeedback: false }) },
  onFbUpgrade: function () { this.setData({ showFeedback: false, showUpg: true, plan: U.PLAN.YEARLY }) },
  onFbContent: function (e) { this.setData({ fbContent: e.detail.value }) },
  onFbContact: function (e) { this.setData({ fbContact: e.detail.value }) },
  onFbAddImg: function () {
    var that = this
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'],
      success: function (res) {
        var imgs = that.data.fbImgs || []
        if (imgs.length >= 3) return
        imgs.push(res.tempFiles[0].tempFilePath)
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

  submitFeedback: function () {
    var that = this
    var content = (this.data.fbContent || '').trim()
    var contact = (this.data.fbContact || '').trim()
    if (!content) { wx.showToast({ title: '请输入反馈内容', icon: 'none', duration: 2000 }); return }
    if (C.isReady()) {
      C.submitFeedback(content, contact, function (err) {
        if (err) {
          wx.showToast({ title: '提交失败，请重试', icon: 'none', duration: 2000 })
        } else {
          that.setData({ showFeedback: false })
          wx.showToast({ title: '感谢反馈！', icon: 'success', duration: 2000 })
        }
      })
    } else {
      // 未开云开发时，复制内容到剪贴板
      wx.setClipboardData({
        data: '反馈：' + content + (contact ? '\n联系方式：' + contact : ''),
        success: function () {
          that.setData({ showFeedback: false })
          wx.showToast({ title: '已复制，请粘贴发送给开发者', icon: 'none', duration: 2500 })
        }
      })
    }
  },
  onPlan: function (e) { this.setData({ plan: e.currentTarget.dataset.plan }) },
  doUpg: function () {
    var that = this, plan = this.data.plan
    if (!C.isReady()) {
      wx.showToast({ title: '支付功能即将上线', icon: 'none', duration: 2000 })
      this.setData({ showUpg: false })
      return
    }
    wx.showLoading({ title: '处理中...', mask: true })
    C.pay(plan, function (err) {
      wx.hideLoading()
      if (err) {
        if (err !== 'pay_cancel') { wx.showToast({ title: '支付失败，请重试', icon: 'none', duration: 2000 }) }
      } else {
        var m = plan === U.PLAN.MONTHLY ? 1 : 12
        var base = app.globalData.proExpiry && app.globalData.proExpiry > U.today() ? app.globalData.proExpiry : U.today()
        app.globalData.isProMember = true
        app.globalData.memberExpired = false
        app.globalData.proExpiry = U.addMonths(base, m)
        app.save()
        that.setData({ showUpg: false, isPro: true, showMember: false, proExpiry: app.globalData.proExpiry })
        wx.showToast({ title: '升级成功！', icon: 'success', duration: 2000 })
      }
    })
  },
  showOk: function () { var that = this; if (that.data.showUndo) { that.setData({ showUndo: false, lastUndo: null }); if (that._ut) { clearTimeout(that._ut); that._ut = null } } if (that._ot) clearTimeout(that._ot); that.setData({ showOkT: true, okMsg: '操作成功' }); that._ot = setTimeout(function () { that.setData({ showOkT: false }) }, 2000) },

  // ===== 历史 =====
  onHist: function (e) {
    var id = e.currentTarget.dataset.id, s = this.getById(id)
    if (!s) return
    var recs = (s.history || []).slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0) })
    this.setData({
      showHist: true,
      histData: { name: s.name, remaining: s.remainingLessons, emoji: s.avatarSrc || '/images/avatars/avatar_1.png', records: recs }
    })
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

  onDebug: function () { this.setData({ showDebug: true }) },
  closeDebug: function () { this.setData({ showDebug: false }) },

  setDebugOffset: function (e) {
    var v = parseInt(e.currentTarget.dataset.v); this._debugOffset = v
    this.setData({ debugOffset: v }); this.reload()
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
    }
    app.save(); this.setData({ debugMember: v }); this.reload()
  },

  resetDebug: function () {
    this._debugOffset = 0; app.globalData.memberExpired = false; app.globalData.isProMember = false; app.globalData.proExpiry = ''
    app.globalData.bannerDismissedToday = { date: U.today(), sleepy: false, expiry: false, memberExpired: false }
    this.setData({ debugOffset: 0, debugExpDays: 0, debugMember: 0 })
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
    var that = this
    wx.showModal({
      title: '确认清空',
      content: '将删除所有学员数据，不可恢复',
      success: function (res) {
        if (res.confirm) {
          app.globalData.students = []; app.globalData.nextId = 0
          app.globalData.memberExpired = false; app.globalData.isProMember = false; app.globalData.proExpiry = ''
          app.globalData.bannerDismissedToday = {}
          app.globalData.welcomeReward = 0; app.globalData.pendingReward = 0
          wx.removeStorageSync('_easter_egg_claimed')
          app.globalData.upgradeShown = false
          wx.removeStorageSync('_pending_easter_sync')
          wx.removeStorageSync('_analytics')
          wx.removeStorageSync('_offline_queue')
          app.save(); that._debugOffset = 0
          that.setData({ showDebug: false, debugOffset: 0, debugExpDays: 0, debugMember: 0 })
          that.reload()
        }
      }
    })
  },

  nop: function () { }
})