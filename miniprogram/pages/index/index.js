var app = getApp()
var U = require('../../utils/util.js')

Page({
  data: {
    sbh: 20, empty: true, students: [], list: [], keyword: '',
    showSleepy: false, sleepyName: '',
    showExpiry: false, expiryName: '', expiryDay: 0,
    showMember: false,
    showClass: false, classTarget: {},
    showForm: false, editing: false, editId: 0,
    fd: { avatarEmoji: '🐯', name: '', totalLessons: 24, expiryDate: '', note: '' },
    showDel: false, delTarget: {},
    showHist: false, histData: { name: '', remaining: 0, emoji: '🐯', records: [] },
    showExpModal: false,
    showUpg: false, plan: U.PLAN.YEARLY,
    showUndo: false, lastUndo: null,
    showLowT: false, lowMsg: '',
    showOkT: false,
    isPro: false, activeCnt: 0,
    _tsX: 0, _tsY: 0, _openIx: -1
  },

  _searchTimer: null,

  onLoad: function () {
    this.setData({ sbh: app.globalData.statusBarHeight || 20 })
    this.reload()
  },

  onShow: function () { this.reload() },

  onUnload: function () {
    if (this._ut) clearTimeout(this._ut)
    if (this._lt) clearTimeout(this._lt)
    if (this._ot) clearTimeout(this._ot)
    if (this._searchTimer) clearTimeout(this._searchTimer)
  },

  reload: function () {
    var ss = app.globalData.students || []
    var pro = app.globalData.isProMember || false
    var bd = app.globalData.bannerDismissedToday || {}
    var td = U.today()

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
        id: s.id, name: s.name, avatarEmoji: s.avatarEmoji,
        note: s.note || '', remainingLessons: s.remainingLessons,
        expiryDate: s.expiryDate, lastClassDate: s.lastClassDate,
        exp: U.isExp(s), low: !U.isExp(s) && s.remainingLessons <= 3 && s.remainingLessons > 0,
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
      if (a.exp && !b.exp) return 1
      if (!a.exp && b.exp) return -1
      var da = a.lastClassDate || '', db = b.lastClassDate || ''
      if (da && db) return db.localeCompare(da)
      if (da && !db) return -1
      if (!da && db) return 1
      return 0
    })

    this.setData({
      students: ss.slice(), isPro: pro,
      showSleepy: sl, sleepyName: sn,
      showExpiry: ex, expiryName: en, expiryDay: ed,
      showMember: mb,
      activeCnt: ac, empty: ac === 0,
      list: r.slice(), _openIx: -1
    })
  },

  getById: function (id) {
    var ss = app.globalData.students || []
    for (var i = 0; i < ss.length; i++) { if (ss[i].id === id) return ss[i] }
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

  onSearchBlur: function () { this.setData({ keyword: '' }); this.reload() },

  // ===== 左滑 =====
  ts: function (e) { this.data._tsX = e.touches[0].clientX; this.data._tsY = e.touches[0].clientY },
  te: function (e) {
    var dx = e.changedTouches[0].clientX - this.data._tsX
    var dy = e.changedTouches[0].clientY - this.data._tsY
    var ix = e.currentTarget.dataset.ix
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
      if (this.data._openIx !== -1 && this.data._openIx !== ix) { this.closeIt(this.data._openIx) }
      if (dx < -30) { this.openIt(ix) } else { this.closeIt(ix) }
    }
  },
  openIt: function (ix) { var list = this.data.list; if (!list[ix]) return; list[ix].open = true; this.setData({ list: list, _openIx: ix }) },
  closeIt: function (ix) { var list = this.data.list; if (ix < 0 || !list[ix]) return; list[ix].open = false; this.setData({ list: list, _openIx: -1 }) },
  closeAll: function () { var l = this.data.list, i = this.data._openIx; if (i >= 0 && l[i]) { l[i].open = false; this.setData({ list: l, _openIx: -1 }) } },
  onScroll: function () { if (this.data._openIx >= 0) this.closeAll() },

  onCardTap: function (e) {
    var ix = parseInt(e.currentTarget.dataset.ix), id = e.currentTarget.dataset.id
    var oldIx = this.data._openIx
    if (oldIx !== -1) {
      this.closeIt(oldIx)
      if (oldIx !== ix) {
        var s = this.getById(id); if (!s) return
        if (U.isExp(s)) { this.setData({ showExpModal: true }) } else { this.setData({ showClass: true, classTarget: s }) }
      }
      return
    }
    var s = this.getById(id); if (!s) return
    if (U.isExp(s)) { this.setData({ showExpModal: true }) } else { this.setData({ showClass: true, classTarget: s }) }
  },

  // ===== 横幅 =====
  dismissSleepy: function () { app.globalData.bannerDismissedToday.sleepy = true; app.save(); this.setData({ showSleepy: false }) },
  dismissExpiry: function () { app.globalData.bannerDismissedToday.expiry = true; app.save(); this.setData({ showExpiry: false }) },
  dismissMember: function () { app.globalData.bannerDismissedToday.memberExpired = true; app.save(); this.setData({ showMember: false }) },

  // ===== 添加 =====
  onAddTap: function () {
    this.closeAll()
    var pro = this.data.isPro, mbr = app.globalData.memberExpired, cnt = this.data.activeCnt
    if (!pro && (cnt >= 10 || mbr)) { this.setData({ showUpg: true, plan: U.PLAN.YEARLY }); return }
    this.onAdd()
  },

  onAdd: function () {
    this.setData({
      showForm: true, editing: false,
      fd: { avatarEmoji: U.rem(U.EMOJIS), name: '', totalLessons: 24, expiryDate: U.addMonths(U.today(), 6), note: '' }
    })
  },

  closeForm: function () { this.setData({ showForm: false, editing: false }) },
  randAv: function () { this.setData({ 'fd.avatarEmoji': U.rem(U.EMOJIS) }) },
  onFdName: function (e) { this.setData({ 'fd.name': e.detail.value }) },
  onFdLessons: function (e) { this.setData({ 'fd.totalLessons': parseInt(e.detail.value) || 0 }) },
  onQuick: function (e) { this.setData({ 'fd.totalLessons': parseInt(e.currentTarget.dataset.v) }) },
  onFdDate: function (e) { this.setData({ 'fd.expiryDate': e.detail.value }) },
  onFdNote: function (e) { this.setData({ 'fd.note': e.detail.value }) },

  onEdit: function (e) {
    var id = e.currentTarget.dataset.id, s = this.getById(id); if (!s) return
    this.closeAll()
    this.setData({
      showForm: true, editing: true, editId: id,
      fd: { avatarEmoji: s.avatarEmoji || '🐯', name: s.name, totalLessons: s.totalLessons || s.remainingLessons, expiryDate: s.expiryDate || '', note: s.note || '' }
    })
  },

  submitForm: function () {
    var fd = this.data.fd
    if (!fd.name || !fd.name.trim()) { wx.showToast({ title: '请输入学员姓名', icon: 'none', duration: 2000 }); return }
    if (!fd.totalLessons || fd.totalLessons <= 0) { wx.showToast({ title: '请输入课时数', icon: 'none', duration: 2000 }); return }
    var ss = app.globalData.students.slice()
    if (this.data.editing) {
      for (var i = 0; i < ss.length; i++) {
        if (ss[i].id === this.data.editId) {
          ss[i].name = fd.name.trim(); ss[i].avatarEmoji = fd.avatarEmoji
          ss[i].remainingLessons = fd.totalLessons; ss[i].totalLessons = fd.totalLessons
          ss[i].expiryDate = fd.expiryDate; ss[i].note = fd.note.trim()
          if (!ss[i].history) ss[i].history = []
          if (!ss[i].lastClassDate) ss[i].lastClassDate = ''
          break
        }
      }
    } else {
      ss.push({
        id: app.globalData.nextId++, name: fd.name.trim(), avatarEmoji: fd.avatarEmoji,
        remainingLessons: fd.totalLessons, totalLessons: fd.totalLessons,
        expiryDate: fd.expiryDate, note: fd.note.trim(),
        lastClassDate: '', history: [{ type: U.REC.RECHARGE, amount: fd.totalLessons, time: U.today() + ' ' + U.formatTime(), ts: Date.now() }], deleted: false, createdAt: U.today()
      })
    }
    app.globalData.students = ss; app.save()
    this.setData({ showForm: false, editing: false }); this.showOk(); this.reload()
  },

  // ===== 删除 =====
  onDel: function (e) { var id = e.currentTarget.dataset.id, s = this.getById(id); if (!s) return; this.closeAll(); this.setData({ showDel: true, delTarget: s }) },
  closeDel: function () { this.setData({ showDel: false }) },
  doDel: function () {
    var tid = this.data.delTarget.id
    app.globalData.students = app.globalData.students.map(function (s) { if (s.id === tid) { s.deleted = true; s.deletedAt = U.today() } return s })
    app.save(); this.setData({ showDel: false })
    var hasActive = false, ss = app.globalData.students
    for (var i = 0; i < ss.length; i++) { if (!ss[i].deleted) { hasActive = true; break } }
    if (hasActive) this.showOk()
    this.reload()
  },

  // ===== 消课 =====
  closeClass: function () { this.setData({ showClass: false }) },
  doClass: function () {
    var that = this, t = this.data.classTarget, td = U.today(), tm = U.formatTime()
    that.data.lastUndo = { id: t.id, rb: t.remainingLessons, lcd: t.lastClassDate }

    app.globalData.students = app.globalData.students.map(function (s) {
      if (s.id == t.id) {
        s.remainingLessons = Math.max(0, s.remainingLessons - 1); s.lastClassDate = td
        s.history = [{ type: U.REC.DEDUCT, amount: 1, time: td + " " + tm, ts: Date.now() }].concat(s.history || [])
      }
      return s
    })
    app.save()

    var ss = app.globalData.students, newList = []
    for (var i = 0; i < ss.length; i++) {
      var s = ss[i]
      if (s.deleted) continue
      newList.push({
        id: s.id, name: s.name, avatarEmoji: s.avatarEmoji,
        note: s.note || "", remainingLessons: s.remainingLessons,
        expiryDate: s.expiryDate, lastClassDate: s.lastClassDate,
        exp: U.isExp(s), low: !U.isExp(s) && s.remainingLessons <= 3 && s.remainingLessons > 0,
        open: false
      })
    }
    newList.sort(function (a, b) {
      if (a.exp !== b.exp) return a.exp ? 1 : -1
      if (a.lastClassDate && b.lastClassDate) {
        if (a.lastClassDate > b.lastClassDate) return -1
        if (a.lastClassDate < b.lastClassDate) return 1
        return 0
      }
      if (a.lastClassDate) return -1
      if (b.lastClassDate) return 1
      return 0
    })

    that.setData({ showClass: false, list: newList, showUndo: true, _openIx: -1 })

    if (that._ut) clearTimeout(that._ut)
    that._ut = setTimeout(function () { that.setData({ showUndo: false, lastUndo: null }) }, 10000)
    var nr = t.remainingLessons - 1
    if (nr > 0 && (nr === 4 || nr === 1)) {
      that._lt = setTimeout(function () {
        that.setData({ showLowT: true, lowMsg: "该学员剩余 " + nr + " 节课，记得提醒续费哦～" })
        that._lt = setTimeout(function () { that.setData({ showLowT: false }) }, 2000)
      }, 500)
    }
  },

  undoClass: function () {
    var a = this.data.lastUndo; if (!a) return
    app.globalData.students = app.globalData.students.map(function (s) {
      if (s.id === a.id) {
        var nh = [], rm = false
        for (var i = 0; i < (s.history || []).length; i++) {
          if (!rm && s.history[i].type === U.REC.DEDUCT) { rm = true; continue }
          nh.push(s.history[i])
        }
        nh.unshift({ type: U.REC.UNDO, amount: 1, time: U.today() + ' ' + U.formatTime(), ts: Date.now() })
        s.remainingLessons = a.rb; s.lastClassDate = a.lcd || s.lastClassDate; s.history = nh
      }
      return s
    })
    app.save(); this.setData({ showUndo: false, lastUndo: null }); this.reload()
  },

  // ===== 弹窗 =====
  closeExpModal: function () { this.setData({ showExpModal: false }) },
  onUpgrade: function () { this.setData({ showUpg: true, plan: U.PLAN.YEARLY }) },
  closeUpg: function () { this.setData({ showUpg: false }) },
  onPlan: function (e) { this.setData({ plan: e.currentTarget.dataset.plan }) },
  doUpg: function () { wx.showToast({ title: '微信支付功能开发中', icon: 'none', duration: 2000 }); this.setData({ showUpg: false }) },
  showOk: function () { var that = this; if (that.data.showUndo) { that.setData({ showUndo: false, lastUndo: null }); if (that._ut) { clearTimeout(that._ut); that._ut = null } } that.setData({ showOkT: true }); that._ot = setTimeout(function () { that.setData({ showOkT: false }) }, 2000) },

  // ===== 历史 =====
  onHist: function (e) {
    var id = e.currentTarget.dataset.id, s = this.getById(id)
    if (!s) return
    var recs = (s.history || []).slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0) })
    this.setData({
      showHist: true,
      histData: { name: s.name, remaining: s.remainingLessons, emoji: s.avatarEmoji || '🐯', records: recs }
    })
  },

  closeHist: function () { this.setData({ showHist: false }) },

  onTapBlank: function () { this.closeAll() },

  nop: function () { }
})