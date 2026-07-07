var app = getApp()
var U = require('../../utils/util.js')
var S = require('../../utils/schedule.js')
var C = require('../../utils/cloud.js')
var A = require('../../utils/analytics.js')
var Sync = require('../../utils/sync.js')

function syncStudentSafe(student) {
  Sync.syncStudentSafe(student)
}

function syncScheduleSafe(schedule) {
  Sync.syncScheduleSafe(schedule)
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj || {}))
}

var CALENDAR_MOTION_MS = 460
var CALENDAR_SWIPE_MS = 320

function formatCurrentClassTime(date) {
  var d = date || new Date()
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + U.p2(d.getHours()) + ':' + U.p2(d.getMinutes())
}

function sameMonth(date, year, month) {
  var d = S.toDate(date)
  return d.getFullYear() === year && d.getMonth() === month - 1
}

function monthAt(year, month, offset) {
  var d = new Date(year, month - 1 + offset, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function dateInMonth(year, month, day) {
  var last = new Date(year, month, 0).getDate()
  return S.fromDate(new Date(year, month - 1, Math.min(day || 1, last)))
}

Page({
  data: {
    sbh: 20,
    navTop: 20,
    today: '',
    year: 2026,
    month: 1,
    monthValue: '',
    monthTitle: '',
    monthCompletedText: '0',
    weekLabels: ['日', '一', '二', '三', '四', '五', '六'],
    days: [],
    weekDays: [],
    monthPages: [],
    weekPages: [],
    calendarAnchorDate: '',
    calendarSwipeCurrent: 1,
    calendarSwipeDuration: CALENDAR_SWIPE_MS,
    calendarCollapsed: false,
    recentScrollEnabled: false,
    recentScrollTop: 0,
    recentHasOverflow: false,
    selectedDate: '',
    selectedTitle: '',
    recentList: [],
    showSheet: false,
    sheetY: 0,
    sheetMaskOpacity: 0,
    sheetTransition: 'transform 280ms cubic-bezier(.2,.8,.2,1)',
    sheetBodyScrollEnabled: true,
    sheetDayHasOverflow: false,
    sheetDayScrollIntoView: '',
    highlightScheduleId: '',
    sheetStudentHasOverflow: false,
    sheetMode: 'day',
    sheetTitle: '',
    daySchedules: [],
    pendingSchedules: [],
    normalSchedules: [],
    daySchedulesAmountText: '0',
    pendingSchedulesAmountText: '0',
    normalSchedulesAmountText: '0',
    studentKeyword: '',
    studentList: [],
    selectedSchedule: null,
    form: {
      id: '',
      studentId: '',
      studentName: '',
      avatarSrc: '/images/avatars/avatar_1.png',
      date: '',
      startTime: '09:00',
      plannedAmount: 1,
      customAmount: '',
      customSelected: false,
      note: ''
    },
    noteHeight: 92,
    noteCount: 0,
    formAmountShake: false,
    dirty: false,
    deductAmount: 1,
    deductCustom: '',
    deductCustomSelected: false,
    deductExtraAmount: 0,
    deductLessAmount: 0,
    deductConfirmTimeText: '',
    showDeductModal: false,
    deductTitle: '选择消课节数',
    deductScheduleTimeText: '',
    detailFromRecent: false,
    detailSource: '',
    editReturnMode: 'students',
    editingScheduleId: '',
    saving: false,
    deducting: false,
    showScheduleDel: false,
    showConfirmDialog: false,
    confirmDialogTitle: '',
    confirmDialogContent: '',
    confirmDialogOkText: '确定',
    confirmDialogDanger: false,
    formAmountLimit: 0,
    showOkT: false,
    okMsg: '操作成功'
  },

  onLoad: function (options) {
    var sys = wx.getSystemInfoSync()
    var statusBarHeight = app.globalData.statusBarHeight || sys.statusBarHeight || 20
    var navTop = statusBarHeight
    var today = U.today()
    var selected = (options && options.date) ? options.date : today
    var targetScheduleId = options && options.scheduleId !== undefined ? options.scheduleId : ''
    var targetSchedule = targetScheduleId !== '' ? S.findById(app.globalData.schedules || [], targetScheduleId) : null
    if (targetSchedule && targetSchedule.date) selected = targetSchedule.date
    var d = S.toDate(selected)
    var that = this
    this.setData({
      sbh: statusBarHeight,
      navTop: navTop,
      today: today,
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      calendarAnchorDate: selected,
      selectedDate: selected,
      selectedTitle: S.dateTitle(selected)
    }, function () {
      that.reload()
      if (targetScheduleId !== '') {
        var detailSource = options && options.source === 'student' ? 'student' : 'recent'
        that.openDay(selected, function () {
          var latest = S.findById(app.globalData.schedules || [], targetScheduleId)
          if (latest && !S.isHidden(latest)) that.openDetail(targetScheduleId, detailSource)
        })
      } else if (options && options.date) {
        that.openDay(selected)
      }
    })
  },

  onReady: function () {
    this.measureRecentScroll()
  },

  onShow: function () {
    this._calendarSwipeLock = false
    this._calendarSwipeDelta = 0
    this.setData({ calendarSwipeCurrent: 1, calendarSwipeDuration: CALENDAR_SWIPE_MS })
    if (C.isOnline()) {
      C.flushQueue()
      if (app.syncCloudQuietly) app.syncCloudQuietly(false)
      if (app.startRealtimeSync) app.startRealtimeSync()
    }
    this.reload()
  },

  onHide: function () {
    if (app.stopRealtimeSync) app.stopRealtimeSync()
    this.clearPageTimers()
  },

  onUnload: function () {
    if (app.stopRealtimeSync) app.stopRealtimeSync()
    this.clearPageTimers()
  },

  reload: function () {
    var today = U.today()
    var nowTs = Date.now()
    var calendar = this.buildCalendarData(nowTs)
    var monthCompleted = this.getMonthCompletedAmount(this.data.year, this.data.month)
    var recent = S.getRecentSchedules(app.globalData.schedules || [], app.globalData.students || [], today, nowTs, 14)
    var data = {
      today: today,
      monthTitle: this.formatMonthTitle(this.data.year, this.data.month),
      monthValue: S.monthValue(this.data.year, this.data.month),
      monthCompletedText: S.formatAmount(monthCompleted || 0),
      days: calendar.days,
      weekDays: calendar.weekDays,
      monthPages: calendar.monthPages,
      weekPages: calendar.weekPages,
      calendarAnchorDate: calendar.anchorDate,
      recentList: recent
    }
    if (this.data.showSheet) {
      var dayData = this.buildDayData(this.data.selectedDate)
      data.selectedTitle = S.dateTitle(this.data.selectedDate)
      data.daySchedules = dayData.all
      data.pendingSchedules = dayData.pending
      data.normalSchedules = dayData.normal
      data.daySchedulesAmountText = dayData.allAmountText
      data.pendingSchedulesAmountText = dayData.pendingAmountText
      data.normalSchedulesAmountText = dayData.normalAmountText
    }
    var that = this
    this.setData(data, function () {
      that.measureRecentScroll()
      that.scheduleStatusRefresh()
    })
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

  formatMonthTitle: function (year, month) {
    return year + '年' + month + '月'
  },

  getMonthCompletedAmount: function (year, month) {
    var prefix = year + '-' + U.p2(month) + '-'
    var total = 0
    var schedules = app.globalData.schedules || []
    var activeStudents = { byId: {}, byUid: {}, byCloud: {} }
    var students = app.globalData.students || []
    for (var j = 0; j < students.length; j++) {
      if (!students[j] || students[j].deleted) continue
      activeStudents.byId[students[j].id] = students[j]
      if (students[j].studentUid) activeStudents.byUid[students[j].studentUid] = students[j]
      if (students[j]._cloudId) activeStudents.byCloud[students[j]._cloudId] = students[j]
    }
    for (var i = 0; i < schedules.length; i++) {
      var s = schedules[i]
      if (S.isHidden(s) || s.status !== S.STATUS.COMPLETED) continue
      var activeById = activeStudents.byId[s.studentId]
      var activeMatched = s.studentUid ? activeStudents.byUid[s.studentUid] : (s.studentCloudId ? activeStudents.byCloud[s.studentCloudId] : activeById)
      if (activeById && !s.studentUid && !s.studentCloudId && s.studentName && activeById.name && s.studentName !== activeById.name) activeMatched = false
      if (!activeMatched) continue
      if ((s.date || '').indexOf(prefix) !== 0) continue
      total += S.actualAmount(s)
    }
    return Math.round(total * 10) / 10
  },

  buildCalendarSetData: function (date, keepCollapsed, options) {
    var opts = options || {}
    var selectedDate = opts.selectedDate !== undefined ? opts.selectedDate : (this.data.selectedDate || date)
    var d = S.toDate(date)
    var year = d.getFullYear()
    var month = d.getMonth() + 1
    var nowTs = Date.now()
    var calendar = this.buildCalendarDataFor(year, month, date, selectedDate, nowTs)
    var monthCompleted = this.getMonthCompletedAmount(year, month)
    var data = {
      year: year,
      month: month,
      calendarAnchorDate: date,
      selectedDate: selectedDate,
      selectedTitle: S.dateTitle(selectedDate),
      monthTitle: this.formatMonthTitle(year, month),
      monthValue: S.monthValue(year, month),
      monthCompletedText: S.formatAmount(monthCompleted || 0),
      days: calendar.days,
      weekDays: calendar.weekDays,
      monthPages: calendar.monthPages,
      weekPages: calendar.weekPages,
      recentList: S.getRecentSchedules(app.globalData.schedules || [], app.globalData.students || [], U.today(), nowTs, 14),
      calendarCollapsed: !!keepCollapsed,
      recentScrollTop: 0
    }
    if (this.data.showSheet) {
      var dayData = this.buildDayData(selectedDate)
      data.daySchedules = dayData.all
      data.pendingSchedules = dayData.pending
      data.normalSchedules = dayData.normal
      data.daySchedulesAmountText = dayData.allAmountText
      data.pendingSchedulesAmountText = dayData.pendingAmountText
      data.normalSchedulesAmountText = dayData.normalAmountText
    }
    return data
  },

  measureRecentScroll: function () {
    var that = this
    if (this._measureTimer) clearTimeout(this._measureTimer)
    if (this._measureTimer2) clearTimeout(this._measureTimer2)
    this._measureTimer = setTimeout(function () {
      that.measureRecentScrollNow()
    }, 40)
    this._measureTimer2 = setTimeout(function () {
      that.measureRecentScrollNow()
    }, CALENDAR_MOTION_MS + 80)
  },

  measureRecentScrollNow: function () {
    var that = this
    var query = that.createSelectorQuery ? that.createSelectorQuery() : wx.createSelectorQuery().in(that)
    query.select('.recent-scroll').boundingClientRect()
    query.select('.recent-scroll-inner').boundingClientRect()
    query.exec(function (rects) {
      var scroll = rects && rects[0]
      var inner = rects && rects[1]
      if (!scroll || !inner) return
      var hasOverflow = inner.height > scroll.height + 8
      if (hasOverflow !== that.data.recentHasOverflow) {
        that.setData({ recentHasOverflow: hasOverflow })
      }
    })
  },

  measureSheetDayOverflow: function () {
    var that = this
    if (this._sheetMeasureTimer) clearTimeout(this._sheetMeasureTimer)
    this._sheetMeasureTimer = setTimeout(function () {
      if (!that.data.showSheet || that.data.sheetMode !== 'day') return
      var query = that.createSelectorQuery ? that.createSelectorQuery() : wx.createSelectorQuery().in(that)
      query.select('.sheet-body').boundingClientRect()
      query.select('.sheet-day-inner').boundingClientRect()
      query.exec(function (rects) {
        var body = rects && rects[0]
        var inner = rects && rects[1]
        if (!body || !inner) return
        that.setData({ sheetDayHasOverflow: inner.height > body.height + 8 })
      })
    }, 60)
  },

  measureSheetStudentOverflow: function () {
    var that = this
    if (this._sheetStudentMeasureTimer) clearTimeout(this._sheetStudentMeasureTimer)
    this._sheetStudentMeasureTimer = setTimeout(function () {
      if (!that.data.showSheet || that.data.sheetMode !== 'students') return
      var query = that.createSelectorQuery ? that.createSelectorQuery() : wx.createSelectorQuery().in(that)
      query.select('.student-body').boundingClientRect()
      query.select('.student-inner').boundingClientRect()
      query.exec(function (rects) {
        var body = rects && rects[0]
        var inner = rects && rects[1]
        if (!body || !inner) return
        that.setData({ sheetStudentHasOverflow: inner.height > body.height + 8 })
      })
    }, 60)
  },

  buildCalendarData: function (nowTs) {
    var anchor = this.data.calendarAnchorDate || this.data.selectedDate || U.today()
    return this.buildCalendarDataFor(this.data.year, this.data.month, anchor, this.data.selectedDate, nowTs)
  },

  buildCalendarDataFor: function (year, month, anchor, selectedDate, nowTs) {
    var monthPages = []
    for (var i = -1; i <= 1; i++) {
      var mv = monthAt(year, month, i)
      monthPages.push({
        key: S.monthValue(mv.year, mv.month),
        days: this.makeDays(mv.year, mv.month, nowTs, selectedDate)
      })
    }
    var weekPages = []
    for (var j = -1; j <= 1; j++) {
      var weekSelected = S.addDays(anchor, j * 7)
      weekPages.push({
        key: weekSelected,
        days: this.makeWeekDays(anchor, j, nowTs, selectedDate)
      })
    }
    return {
      anchorDate: anchor,
      days: monthPages[1].days,
      weekDays: weekPages[1].days,
      monthPages: monthPages,
      weekPages: weekPages
    }
  },

  makeDateItem: function (d, viewYear, viewMonth, nowTs, selectedDate) {
    var date = S.fromDate(d)
    var sum = S.summarizeDay(app.globalData.schedules || [], app.globalData.students || [], date, nowTs)
    var isToday = date === U.today()
    return {
      date: date,
      day: d.getDate(),
      inMonth: d.getMonth() === viewMonth - 1,
      today: isToday,
      selectedOnly: date === selectedDate && !isToday,
      red: sum.red,
      green: sum.green,
      gray: sum.gray
    }
  },

  makeDays: function (year, month, nowTs, selectedDate) {
    var first = new Date(year, month - 1, 1)
    var start = new Date(year, month - 1, 1 - first.getDay())
    var arr = []
    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      arr.push(this.makeDateItem(d, year, month, nowTs, selectedDate))
    }
    return arr
  },

  makeWeekDays: function (anchorDate, offset, nowTs, selectedDate) {
    var anchor = S.toDate(S.addDays(anchorDate, (offset || 0) * 7))
    var start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay())
    var arr = []
    for (var i = 0; i < 7; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      arr.push(this.makeDateItem(d, anchor.getFullYear(), anchor.getMonth() + 1, nowTs, selectedDate))
    }
    return arr
  },

  buildDayData: function (date) {
    var all = S.getDaySchedules(app.globalData.schedules || [], app.globalData.students || [], date, Date.now())
    var pending = []
    var normal = []
    for (var i = 0; i < all.length; i++) {
      if (all[i].overdue) pending.push(all[i])
      else normal.push(all[i])
    }
    return {
      all: all,
      pending: pending,
      normal: normal,
      allAmountText: this.sumScheduleAmountText(all),
      pendingAmountText: this.sumScheduleAmountText(pending),
      normalAmountText: this.sumScheduleAmountText(normal)
    }
  },

  sumScheduleAmountText: function (list) {
    var total = 0
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {}
      var amount = item.displayAmount !== undefined ? item.displayAmount : item.plannedAmount
      total += S.parseAmount(amount, 0)
    }
    return S.formatAmount(total)
  },

  goBack: function () {
    var pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    if (pages && pages.length > 1) {
      wx.navigateBack()
      return
    }
    wx.redirectTo({
      url: '/pages/index/index',
      fail: function () {
        wx.reLaunch({ url: '/pages/index/index' })
      }
    })
  },

  onPrevMonth: function () {
    this.animateCalendarBy(-1)
  },

  onNextMonth: function () {
    this.animateCalendarBy(1)
  },

  resetCalendarSwipe: function () {
    var that = this
    this.setData({ calendarSwipeDuration: 0 }, function () {
      that.setData({ calendarSwipeCurrent: 1 }, function () {
        if (that._calendarDurationTimer) clearTimeout(that._calendarDurationTimer)
        that._calendarDurationTimer = setTimeout(function () {
          that.setData({ calendarSwipeDuration: CALENDAR_SWIPE_MS })
          that._calendarDurationTimer = null
        }, 50)
      })
    })
  },

  getCalendarTargetDate: function (delta) {
    if (this.data.calendarCollapsed) {
      var weekBase = this.data.calendarAnchorDate || this.data.selectedDate || U.today()
      return S.addDays(weekBase, delta * 7)
    }
    var monthBase = S.toDate(this.data.calendarAnchorDate || this.data.selectedDate || U.today())
    var next = monthAt(this.data.year, this.data.month, delta)
    return dateInMonth(next.year, next.month, monthBase.getDate())
  },

  animateCalendarBy: function (delta) {
    if (this._calendarSwipeLock) return
    this._calendarSwipeLock = true
    this._calendarSwipeDelta = delta
    this.blockGestureTap()
    this.scheduleCalendarSwipeFallback()
    this.setData({
      calendarSwipeDuration: CALENDAR_SWIPE_MS,
      calendarSwipeCurrent: delta > 0 ? 2 : 0
    })
  },

  commitCalendarSwipe: function (delta) {
    var that = this
    this.clearCalendarTimers()
    this._recentScrollTop = 0
    var data = this.buildCalendarSetData(this.getCalendarTargetDate(delta), this.data.calendarCollapsed)
    data.calendarSwipeDuration = 0
    data.calendarSwipeCurrent = 1
    data.recentScrollEnabled = this.data.calendarCollapsed && this.data.recentScrollEnabled
    this.setData(data, function () {
      that._calendarSwipeLock = false
      that._calendarSwipeDelta = 0
      if (that._calendarDurationTimer) clearTimeout(that._calendarDurationTimer)
      that._calendarDurationTimer = setTimeout(function () {
        that.setData({ calendarSwipeDuration: CALENDAR_SWIPE_MS })
        that._calendarDurationTimer = null
      }, 50)
      that.measureRecentScroll()
    })
  },

  updateCalendarBase: function (date, keepCollapsed) {
    var that = this
    this.clearCalendarTimers()
    this._recentScrollTop = 0
    var data = this.buildCalendarSetData(date, keepCollapsed)
    data.recentScrollEnabled = !!keepCollapsed && this.data.recentScrollEnabled
    this.setData(data, function () {
      that.resetCalendarSwipe()
      that.measureRecentScroll()
    })
  },

  shiftMonthBy: function (delta) {
    this.updateCalendarBase(this.getCalendarTargetDate(delta), false)
  },

  shiftWeekBy: function (delta) {
    this.updateCalendarBase(this.getCalendarTargetDate(delta), true)
  },

  onMonthPick: function (e) {
    var v = e.detail.value || ''
    var p = v.split('-')
    if (p.length < 2) return
    var year = parseInt(p[0]) || this.data.year
    var month = parseInt(p[1]) || this.data.month
    var target = dateInMonth(year, month, 1)
    if (sameMonth(U.today(), year, month)) target = U.today()
    this.updateCalendarBase(target, this.data.calendarCollapsed)
  },

  onCalendarSwipeChange: function (e) {
    var detail = e.detail || {}
    if (detail.current === 1) return
    if (detail.current !== 0 && detail.current !== 2) return
    var delta = detail.current > 1 ? 1 : -1
    var mode = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.mode) || ''
    if (mode && mode !== (this.data.calendarCollapsed ? 'week' : 'month')) return
    if (this._calendarSwipeLock && this._calendarSwipeDelta) return
    if (detail.source && detail.source !== 'touch') return
    this._calendarSwipeLock = true
    this._calendarSwipeDelta = delta
    this.scheduleCalendarSwipeFallback()
    this.blockGestureTap()
  },

  onCalendarSwipeFinish: function (e) {
    var detail = e.detail || {}
    var current = detail.current
    if (current !== 0 && current !== 2) return
    var mode = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.mode) || ''
    if (mode && mode !== (this.data.calendarCollapsed ? 'week' : 'month')) return
    var delta = this._calendarSwipeDelta || (current > 1 ? 1 : -1)
    if (!delta) return
    this.commitCalendarSwipe(delta)
  },

  scheduleCalendarSwipeFallback: function () {
    var that = this
    if (this._calendarSwipeTimer) clearTimeout(this._calendarSwipeTimer)
    this._calendarSwipeTimer = setTimeout(function () {
      if (that._calendarSwipeLock && that._calendarSwipeDelta) {
        that.commitCalendarSwipe(that._calendarSwipeDelta)
      }
    }, CALENDAR_SWIPE_MS + 180)
  },

  onRecentScroll: function (e) {
    var top = (e.detail && e.detail.scrollTop) || 0
    this._recentScrollTop = top
  },

  onRecentScrollToUpper: function () {
    this._recentScrollTop = 0
  },

  expandCalendar: function () {
    this.setCalendarCollapsed(!this.data.calendarCollapsed)
  },

  setCalendarCollapsed: function (collapsed) {
    if (this.data.calendarCollapsed === collapsed) return
    this.clearCalendarTimers()
    var that = this
    this._calendarAnimating = true
    this._recentScrollTop = 0
    if (collapsed) {
      var todayData = this.buildCalendarSetData(U.today(), true)
      todayData.recentScrollEnabled = false
      todayData.calendarSwipeDuration = 0
      todayData.calendarSwipeCurrent = 1
      this.setData(todayData, function () {
        that.setData({ calendarSwipeDuration: CALENDAR_SWIPE_MS })
      })
      this._calendarTimer = setTimeout(function () {
        that._calendarAnimating = false
        if (that.data.calendarCollapsed && !that._recentTouchActive) {
          that.setData({ recentScrollEnabled: true })
        } else if (that.data.calendarCollapsed) {
          that._pendingEnableRecentScroll = true
        }
        that.measureRecentScroll()
      }, CALENDAR_MOTION_MS)
      return
    }
    this.setData({
      calendarCollapsed: false,
      recentScrollEnabled: false,
      recentScrollTop: 1
    }, function () {
      that.setData({ recentScrollTop: 0 }, function () {
      })
    })
    this._calendarTimer = setTimeout(function () {
      that._calendarAnimating = false
      that._pendingEnableRecentScroll = false
      that.measureRecentScroll()
    }, CALENDAR_MOTION_MS)
  },

  clearCalendarTimers: function () {
    if (this._calendarTimer) clearTimeout(this._calendarTimer)
    if (this._calendarSwipeTimer) clearTimeout(this._calendarSwipeTimer)
    if (this._calendarDurationTimer) clearTimeout(this._calendarDurationTimer)
    this._calendarTimer = null
    this._calendarSwipeTimer = null
    this._calendarDurationTimer = null
    this._calendarAnimating = false
    this._pendingEnableRecentScroll = false
    this._calendarSwipeLock = false
    this._calendarSwipeDelta = 0
  },

  clearPageTimers: function () {
    this.clearCalendarTimers()
    if (this._measureTimer) clearTimeout(this._measureTimer)
    if (this._measureTimer2) clearTimeout(this._measureTimer2)
    if (this._ignoreGestureTapTimer) clearTimeout(this._ignoreGestureTapTimer)
    if (this._sheetTimer) clearTimeout(this._sheetTimer)
    if (this._sheetMeasureTimer) clearTimeout(this._sheetMeasureTimer)
    if (this._sheetStudentMeasureTimer) clearTimeout(this._sheetStudentMeasureTimer)
    if (this._highlightTimer) clearTimeout(this._highlightTimer)
    if (this._highlightScrollTimer) clearTimeout(this._highlightScrollTimer)
    if (this._formAmountShakeTimer) clearTimeout(this._formAmountShakeTimer)
    if (this._formAmountShakeStartTimer) clearTimeout(this._formAmountShakeStartTimer)
    if (this._calendarDurationTimer) clearTimeout(this._calendarDurationTimer)
    if (this._sheetCloseResetTimer) clearTimeout(this._sheetCloseResetTimer)
    if (this._okToastTimer) clearTimeout(this._okToastTimer)
    this.clearStatusRefreshTimer()
    this._measureTimer = null
    this._measureTimer2 = null
    this._ignoreGestureTapTimer = null
    this._sheetTimer = null
    this._sheetMeasureTimer = null
    this._sheetStudentMeasureTimer = null
    this._highlightTimer = null
    this._highlightScrollTimer = null
    this._formAmountShakeTimer = null
    this._formAmountShakeStartTimer = null
    this._calendarDurationTimer = null
    this._sheetCloseResetTimer = null
    this._okToastTimer = null
    this._sheetTouch = null
    this._recentTouch = null
    this._recentTouchActive = false
    this._sheetClosing = false
    this._ignoreGestureTap = false
  },

  showOkText: function (text) {
    var that = this
    if (this._okToastTimer) {
      clearTimeout(this._okToastTimer)
      this._okToastTimer = null
    }
    this.setData({
      showOkT: true,
      okMsg: text || '操作成功'
    })
    this._okToastTimer = setTimeout(function () {
      that._okToastTimer = null
      that.setData({ showOkT: false })
    }, 1600)
  },

  onRecentTouchStart: function (e) {
    if (this._recentTouchActive && this._recentTouch) return
    var t = e.touches && e.touches[0]
    if (!t) return
    this._recentTouchActive = true
    this._recentTouch = {
      x: t.clientX,
      y: t.clientY,
      area: (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.gestureArea) || '',
      handled: false
    }
  },

  onRecentTouchMove: function (e) {
    var start = this._recentTouch
    var t = e.touches && e.touches[0]
    if (!start || !t || start.handled) return
    this.handleRecentGesture(t.clientX - start.x, t.clientY - start.y, 20, start)
  },

  onRecentTouchEnd: function (e) {
    var start = this._recentTouch
    var t = e.changedTouches && e.changedTouches[0]
    this._recentTouch = null
    this._recentTouchActive = false
    this.enableRecentScrollAfterGesture()
    if (!start || !t) return
    if (start.handled) return
    this.handleRecentGesture(t.clientX - start.x, t.clientY - start.y, 28, start)
  },

  onRecentTouchCancel: function () {
    this._recentTouch = null
    this._recentTouchActive = false
    this.enableRecentScrollAfterGesture()
  },

  handleRecentGesture: function (dx, dy, threshold, touchState) {
    if (Math.abs(dy) < threshold || Math.abs(dy) < Math.abs(dx) * 1.15) return
    if (dy < 0 && !this.data.calendarCollapsed) {
      if (touchState) touchState.handled = true
      this.blockGestureTap()
      this.setCalendarCollapsed(true)
    } else if (dy > 0 && this.data.calendarCollapsed && (touchState.area === 'calendar' || (this._recentScrollTop || 0) <= 2)) {
      if (touchState) touchState.handled = true
      this.blockGestureTap()
      this.setCalendarCollapsed(false)
    }
  },

  enableRecentScrollAfterGesture: function () {
    if (!this.data.calendarCollapsed) return
    if (this._calendarAnimating) {
      this._pendingEnableRecentScroll = true
      return
    }
    if (this._pendingEnableRecentScroll || !this.data.recentScrollEnabled) {
      this._pendingEnableRecentScroll = false
      this.setData({ recentScrollEnabled: true })
    }
  },

  blockGestureTap: function () {
    var that = this
    this._ignoreGestureTap = true
    if (this._ignoreGestureTapTimer) clearTimeout(this._ignoreGestureTapTimer)
    this._ignoreGestureTapTimer = setTimeout(function () {
      that._ignoreGestureTap = false
    }, 260)
  },

  onDayTap: function (e) {
    if (this._ignoreGestureTap) return
    this.openDay(e.currentTarget.dataset.date)
  },

  onRecentTap: function (e) {
    if (this._ignoreGestureTap) return
    var that = this
    var id = e.currentTarget.dataset.id
    var s = S.findById(app.globalData.schedules || [], id)
    if (!s) return
    this.openDay(s.date, function () {
      that.openDetail(id, 'recent')
    })
  },

  openDay: function (date, afterOpen) {
    var dayData = this.buildDayData(date)
    var d = S.toDate(date)
    var that = this
    var opening = !this.data.showSheet
    var h = this.getSheetOffscreenY()
    this.setData({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      calendarAnchorDate: date,
      selectedDate: date,
      selectedTitle: S.dateTitle(date),
      showSheet: true,
      sheetY: opening ? h : 0,
      sheetMaskOpacity: opening ? 0 : 1,
      sheetTransition: opening ? 'none' : 'transform 280ms cubic-bezier(.2,.8,.2,1)',
      sheetBodyScrollEnabled: true,
      sheetDayHasOverflow: false,
      sheetDayScrollIntoView: '',
      highlightScheduleId: '',
      sheetMode: 'day',
      sheetTitle: S.dateTitle(date),
      daySchedules: dayData.all,
      pendingSchedules: dayData.pending,
      normalSchedules: dayData.normal,
      daySchedulesAmountText: dayData.allAmountText,
      pendingSchedulesAmountText: dayData.pendingAmountText,
      normalSchedulesAmountText: dayData.normalAmountText,
      dirty: false
    }, function () {
      that.animateSheetIn(opening)
      that.reload()
      that.resetCalendarSwipe()
      that.measureSheetDayOverflow()
      if (typeof afterOpen === 'function') afterOpen()
    })
  },

  onSheetMask: function () {
    this.tryCloseSheet()
  },

  getSheetOffscreenY: function () {
    try {
      return (wx.getSystemInfoSync().windowHeight || 800) + 40
    } catch (e) {
      return 840
    }
  },

  animateSheetIn: function (opening) {
    var that = this
    this._sheetClosing = false
    this._sheetScrollTop = 0
    this._sheetCurrentY = 0
    if (!opening) return
    if (this._sheetTimer) clearTimeout(this._sheetTimer)
    this._sheetTimer = setTimeout(function () {
      that.setData({
        sheetY: 0,
        sheetMaskOpacity: 1,
        sheetTransition: 'transform 300ms cubic-bezier(.2,.8,.2,1)'
      })
    }, 20)
  },

  closeSheetAnimated: function (extraData) {
    if (this._sheetClosing) return
    var that = this
    var h = this.getSheetOffscreenY()
    this._sheetClosing = true
    this._sheetTouch = null
    this._sheetCurrentY = h
    if (this._sheetTimer) clearTimeout(this._sheetTimer)
    this.setData({
      sheetY: h,
      sheetMaskOpacity: 0,
      sheetTransition: 'transform 250ms cubic-bezier(.32,.72,.28,1)',
      sheetBodyScrollEnabled: true
    })
    this._sheetTimer = setTimeout(function () {
      var data = {
        showSheet: false,
        sheetMode: 'day',
        selectedSchedule: null,
        sheetY: 0,
        sheetMaskOpacity: 0,
        sheetTransition: 'transform 280ms cubic-bezier(.2,.8,.2,1)',
        sheetBodyScrollEnabled: true,
        sheetStudentHasOverflow: false,
        showScheduleDel: false,
        showDeductModal: false,
        deducting: false,
        deductAmount: 1,
        deductCustom: '',
        deductCustomSelected: false,
        deductExtraAmount: 0,
        deductLessAmount: 0,
        deductTitle: '选择消课节数',
        deductScheduleTimeText: '',
      deductConfirmTimeText: '',
      detailFromRecent: false,
      detailSource: '',
      editReturnMode: 'students',
      editingScheduleId: '',
      saving: false
    }
      if (extraData) {
        for (var k in extraData) data[k] = extraData[k]
      }
    that._sheetClosing = false
    that._saving = false
    that.setData(data)
    }, 270)
  },

  tryCloseSheet: function () {
    var that = this
    if (!this.data.dirty) {
      this.closeSheetAnimated()
      return
    }
    this.openConfirmDialog({
      title: '还没保存',
      content: '当前填写的排课信息还没有保存，确定退出吗？',
      okText: '退出',
      danger: true
    }, function () {
      that.closeSheetAnimated({ dirty: false })
    })
  },

  onSheetBodyScroll: function (e) {
    this._sheetScrollTop = (e.detail && e.detail.scrollTop) || 0
  },

  onSheetBodyScrollToUpper: function () {
    this._sheetScrollTop = 0
  },

  isSheetDragMode: function () {
    return this.data.sheetMode === 'day' || this.data.sheetMode === 'students' || this.data.sheetMode === 'edit' || this.data.sheetMode === 'detail'
  },

  resetSheetDragThenTryClose: function () {
    var that = this
    this._sheetCurrentY = 0
    this.setData({
      sheetY: 0,
      sheetMaskOpacity: 1,
      sheetTransition: 'transform 240ms cubic-bezier(.2,.8,.2,1)',
      sheetBodyScrollEnabled: true
    }, function () {
      if (that._sheetCloseResetTimer) clearTimeout(that._sheetCloseResetTimer)
      that._sheetCloseResetTimer = setTimeout(function () {
        that._sheetCloseResetTimer = null
        that.tryCloseSheet()
      }, 180)
    })
  },

  onSheetTouchStart: function (e) {
    if (!this.data.showSheet || !this.isSheetDragMode() || this._sheetClosing) return
    var t = e.touches && e.touches[0]
    if (!t) return
    this._sheetTouch = {
      startY: t.clientY,
      lastY: t.clientY,
      lastTime: Date.now(),
      dragStartY: 0,
      dragging: false
    }
  },

  onSheetTouchMove: function (e) {
    var st = this._sheetTouch
    if (!st || !this.isSheetDragMode() || this._sheetClosing) return
    var t = e.touches && e.touches[0]
    if (!t) return
    var dy = t.clientY - st.startY
    st.lastY = t.clientY
    st.lastTime = Date.now()
    if (!st.dragging) {
      if (dy <= 8 || (this._sheetScrollTop || 0) > 2) return
      st.dragging = true
      st.dragStartY = t.clientY
      st.dragStartTime = Date.now()
      this._sheetCurrentY = 0
      this.setData({
        sheetTransition: 'none',
        sheetBodyScrollEnabled: false
      })
      return
    }
    var y = Math.max(0, Math.round((t.clientY - st.dragStartY) * 0.86))
    if (Math.abs(y - (this._sheetCurrentY || 0)) < 2) return
    this._sheetCurrentY = y
    this.setData({
      sheetY: y,
      sheetMaskOpacity: Math.max(0.18, 1 - y / 520)
    })
  },

  onSheetTouchEnd: function () {
    var st = this._sheetTouch
    this._sheetTouch = null
    if (!st || !st.dragging) {
      this.setData({ sheetBodyScrollEnabled: true })
      return
    }
    var y = this._sheetCurrentY || 0
    var velocity = y / Math.max(1, Date.now() - (st.dragStartTime || Date.now()))
    if (y > 120 || velocity > 0.55) {
      if (this.data.sheetMode === 'edit' && this.data.dirty) {
        this.resetSheetDragThenTryClose()
        return
      }
      this.closeSheetAnimated()
      return
    }
    this._sheetCurrentY = 0
    this.setData({
      sheetY: 0,
      sheetMaskOpacity: 1,
      sheetTransition: 'transform 240ms cubic-bezier(.2,.8,.2,1)',
      sheetBodyScrollEnabled: true
    })
  },

  onSheetTouchCancel: function () {
    this._sheetTouch = null
    this._sheetCurrentY = 0
    this.setData({
      sheetY: 0,
      sheetMaskOpacity: 1,
      sheetTransition: 'transform 240ms cubic-bezier(.2,.8,.2,1)',
      sheetBodyScrollEnabled: true
    })
  },

  sheetBack: function () {
    var that = this
    if (this.data.sheetMode === 'day') {
      this.tryCloseSheet()
      return
    }
    if (this.data.sheetMode === 'edit') {
      if (this.data.dirty) {
        var editBackText = this.data.editReturnMode === 'detail' ? '放弃当前修改并返回排课详情吗？' : '放弃当前修改并返回选择学员吗？'
        this.openConfirmDialog({
          title: '还没保存',
          content: editBackText,
          okText: '放弃',
          danger: true
        }, function () {
          that.backFromEdit()
        })
        return
      }
      this.backFromEdit()
      return
    }
    if (this.data.dirty) {
      this.openConfirmDialog({
        title: '还没保存',
        content: '放弃当前修改并返回当天排课吗？',
        okText: '放弃',
        danger: true
      }, function () {
        that.backToDay()
      })
      return
    }
    this.backToDay()
  },

  backToDay: function (targetDate, highlightId) {
    this._saving = false
    this._deducting = false
    this._deductMoreConfirming = false
    if (this._highlightTimer) clearTimeout(this._highlightTimer)
    var date = targetDate || this.data.selectedDate
    var d = S.toDate(date)
    var dayData = this.buildDayData(date)
    var that = this
    var scrollId = highlightId !== undefined && highlightId !== null && highlightId !== '' ? ('schedule-card-' + highlightId) : ''
    this.setData({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      calendarAnchorDate: date,
      selectedDate: date,
      selectedTitle: S.dateTitle(date),
      sheetMode: 'day',
      sheetTitle: S.dateTitle(date),
      daySchedules: dayData.all,
      pendingSchedules: dayData.pending,
      normalSchedules: dayData.normal,
      daySchedulesAmountText: dayData.allAmountText,
      pendingSchedulesAmountText: dayData.pendingAmountText,
      normalSchedulesAmountText: dayData.normalAmountText,
      sheetDayScrollIntoView: '',
      highlightScheduleId: highlightId || '',
      selectedSchedule: null,
      detailFromRecent: false,
      detailSource: '',
      editReturnMode: 'students',
      editingScheduleId: '',
      dirty: false,
      deductExtraAmount: 0,
      deductLessAmount: 0,
      showDeductModal: false,
      deductTitle: '选择消课节数',
      deductScheduleTimeText: '',
      deductConfirmTimeText: '',
      saving: false,
      deducting: false
    }, function () {
      that.reload()
      that.measureSheetDayOverflow()
      if (scrollId) {
        if (that._highlightScrollTimer) clearTimeout(that._highlightScrollTimer)
        that._highlightScrollTimer = setTimeout(function () {
          that.setData({ sheetDayScrollIntoView: scrollId })
          that._highlightScrollTimer = null
        }, 80)
        that._highlightTimer = setTimeout(function () {
          that.setData({ highlightScheduleId: '', sheetDayScrollIntoView: '' })
        }, 1700)
      }
    })
  },

  openSelectStudent: function () {
    var that = this
    this._sheetScrollTop = 0
    this.setData({
      sheetMode: 'students',
      sheetTitle: '选择学员',
      studentKeyword: '',
      studentList: this.buildStudentList(''),
      sheetBodyScrollEnabled: true,
      sheetStudentHasOverflow: false,
      editReturnMode: 'students',
      editingScheduleId: '',
      dirty: false
    }, function () {
      that.measureSheetStudentOverflow()
    })
  },

  onStudentSearch: function (e) {
    var that = this
    var kw = e.detail.value || ''
    this._sheetScrollTop = 0
    this.setData({
      studentKeyword: kw,
      studentList: this.buildStudentList(kw),
      sheetStudentHasOverflow: false
    }, function () {
      that.measureSheetStudentOverflow()
    })
  },

  buildStudentList: function (kw) {
    var q = (kw || '').trim().toLowerCase()
    var arr = []
    var ss = app.globalData.students || []
    for (var i = 0; i < ss.length; i++) {
      var s = ss[i]
      if (s.deleted) continue
      if (q && (s.name || '').toLowerCase().indexOf(q) === -1) continue
      var remaining = S.parseAmount(s.remainingLessons, 0)
      var reserved = this.getReservedLessons(s.id, null)
      var available = Math.max(0, Math.round((remaining - reserved) * 10) / 10)
      var exp = U.isExp(s)
      var disabled = exp || available <= 0
      var statusText = exp ? '已过期' : (available <= 0 ? '不可排课' : '可排课时数')
      var statusTone = disabled ? 'gray' : (available <= 3 ? 'red' : 'green')
      arr.push({
        id: s.id,
        name: s.name,
        avatarSrc: s.avatarSrc || '/images/avatars/avatar_1.png',
        note: s.note || '',
        remainingLessons: remaining,
        availableLessons: available,
        reservedLessons: reserved,
        remainingText: S.formatAmount(available) + '节',
        exp: exp,
        disabled: disabled,
        low: !exp && available > 0 && available <= 3,
        sortGroup: exp ? 3 : (available <= 0 ? 2 : (available <= 3 ? 1 : 0)),
        sortTime: s.lastModified || s.updatedAt || s.lastClassTs || 0,
        statusText: statusText,
        statusTone: statusTone
      })
    }
    arr.sort(function (a, b) {
      if (a.sortGroup !== b.sortGroup) return a.sortGroup - b.sortGroup
      if ((a.sortTime || 0) !== (b.sortTime || 0)) return (b.sortTime || 0) - (a.sortTime || 0)
      return (a.name || '').localeCompare(b.name || '')
    })
    return arr
  },

  onChooseStudent: function (e) {
    var student = this.getStudent(e.currentTarget.dataset.id)
    if (!student) return
    if (U.isExp(student)) {
      wx.showToast({ title: '该学员已过期', icon: 'none', duration: 1800 })
      return
    }
    if (S.parseAmount(student.remainingLessons, 0) <= 0) {
      wx.showToast({ title: '该学员不可排课', icon: 'none', duration: 1800 })
      return
    }
    var available = this.getFormAmountLimitForStudent(student.id, '')
    if (available <= 0) {
      wx.showToast({ title: '该学员不可排课', icon: 'none', duration: 1800 })
      return
    }
    var defaultAmount = available >= 1 ? 1 : available
    var defaultCustom = defaultAmount !== 1 && defaultAmount !== 2
    var slot = this.defaultSlot(this.data.selectedDate)
    this._sheetScrollTop = 0
    this._formNoteDraft = ''
    this.setData({
      sheetMode: 'edit',
      sheetTitle: '编辑排课',
      form: {
        id: '',
        studentId: student.id,
        studentName: student.name,
        avatarSrc: student.avatarSrc || '/images/avatars/avatar_1.png',
        date: slot.date,
        startTime: slot.startTime,
        plannedAmount: defaultAmount,
        customAmount: defaultCustom ? S.formatAmount(defaultAmount) : '',
        customSelected: defaultCustom,
        note: ''
      },
      noteHeight: 92,
      noteCount: 0,
      formAmountShake: false,
      formAmountLimit: available,
      editReturnMode: 'students',
      editingScheduleId: '',
      dirty: false
    })
  },

  defaultSlot: function (date) {
    if (date !== U.today()) return { date: date, startTime: '09:00' }
    var d = new Date()
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 1)
    if (d.getDate() !== new Date().getDate()) {
      return { date: S.addDays(date, 1), startTime: '09:00' }
    }
    return { date: date, startTime: U.p2(d.getHours()) + ':00' }
  },

  getStudent: function (id) {
    var ss = app.globalData.students || []
    for (var i = 0; i < ss.length; i++) {
      if (ss[i].id == id) return ss[i]
    }
    return null
  },

  getSchedule: function (id) {
    return S.findById(app.globalData.schedules || [], id)
  },

  getReservedLessons: function (studentId, excludeId) {
    var total = 0
    var schedules = app.globalData.schedules || []
    for (var i = 0; i < schedules.length; i++) {
      var sc = schedules[i]
      if (S.isHidden(sc) || sc.status !== S.STATUS.SCHEDULED || sc.studentId != studentId || sc.id == excludeId) continue
      total += S.plannedAmount(sc)
    }
    return total
  },

  getFormAmountLimit: function () {
    var f = this.data.form || {}
    return this.getFormAmountLimitForStudent(f.studentId, f.id)
  },

  getFormAmountUiLimit: function () {
    var f = this.data.form || {}
    var hardLimit = this.getFormAmountLimitForStudent(f.studentId, f.id)
    var sc = this.getSchedule(f.id)
    var oldAmount = sc ? S.plannedAmount(sc) : 0
    return Math.max(hardLimit, oldAmount)
  },

  getFormAmountLimitForStudent: function (studentId, excludeId) {
    var student = this.getStudent(studentId)
    if (!student) return 0
    var remaining = S.parseAmount(student.remainingLessons, 0)
    var reserved = this.getReservedLessons(student.id, excludeId)
    return Math.max(0, Math.round((remaining - reserved) * 10) / 10)
  },

  findStudentTimeConflict: function (form) {
    if (!form || !form.studentId || !form.date || !form.startTime) return null
    var probe = {
      date: form.date,
      startTime: form.startTime,
      plannedAmount: form.plannedAmount
    }
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

  shakeFormAmount: function () {
    var that = this
    if (this._formAmountShakeTimer) clearTimeout(this._formAmountShakeTimer)
    this.setData({ formAmountShake: false }, function () {
      if (that._formAmountShakeStartTimer) clearTimeout(that._formAmountShakeStartTimer)
      that._formAmountShakeStartTimer = setTimeout(function () {
        that._formAmountShakeStartTimer = null
        that.setData({ formAmountShake: true })
        that._formAmountShakeTimer = setTimeout(function () {
          that.setData({ formAmountShake: false })
          that._formAmountShakeTimer = null
        }, 360)
      }, 20)
    })
  },

  openDetailTap: function (e) {
    this.openDetail(e.currentTarget.dataset.id, 'day')
  },

  openDetail: function (id, source) {
    var s = this.getSchedule(id)
    if (!s) return
    var list = S.getDaySchedules([s], app.globalData.students || [], s.date, Date.now())
    this.setData({
      selectedSchedule: list[0] || null,
      sheetMode: 'detail',
      sheetTitle: '排课详情',
      detailFromRecent: source === 'recent' || source === 'student',
      detailSource: source || 'day',
      dirty: false
    })
  },

  editSelected: function () {
    if (!this.data.selectedSchedule) return
    this.openEdit(this.data.selectedSchedule.id, 'detail')
  },

  openEditTap: function (e) {
    this.openEdit(e.currentTarget.dataset.id, 'day')
  },

  openEdit: function (id, source) {
    var s = this.getSchedule(id)
    if (!s) return
    var amount = S.plannedAmount(s)
    var limit = Math.max(this.getFormAmountLimitForStudent(s.studentId, s.id), amount)
    var customSelected = amount !== 1 && amount !== 2
    var note = s.note || ''
    this._sheetScrollTop = 0
    this._formNoteDraft = note
    this.setData({
      sheetMode: 'edit',
      sheetTitle: '编辑排课',
      form: {
        id: s.id,
        studentId: s.studentId,
        studentName: s.studentName,
        avatarSrc: s.avatarSrc || '/images/avatars/avatar_1.png',
        date: s.date,
        startTime: S.formatHM(s.startTime),
        plannedAmount: amount,
        customAmount: amount === 1 || amount === 2 ? '' : String(amount),
        customSelected: customSelected,
        note: note
      },
      noteHeight: this.getNoteHeight(note),
      noteCount: note.length,
      formAmountShake: false,
      formAmountLimit: limit,
      editReturnMode: source === 'detail' ? 'detail' : 'day',
      editingScheduleId: s.id,
      dirty: false
    })
  },

  backFromEdit: function () {
    var mode = this.data.editReturnMode
    var id = this.data.editingScheduleId || (this.data.form && this.data.form.id)
    if (mode === 'detail' && id !== '' && id !== null && id !== undefined) {
      var s = this.getSchedule(id)
      if (s && !S.isHidden(s)) {
        this.openDetail(id, this.data.detailSource || (this.data.detailFromRecent ? 'recent' : 'day'))
        return
      }
    }
    if (mode === 'day') {
      this.backToDay()
      return
    }
    this.openSelectStudent()
  },

  getNoteHeight: function (text, lineCount) {
    var minH = 92
    var maxH = 210
    var lines = lineCount || 1
    var str = text || ''
    var byBreaks = str ? str.split('\n').length : 1
    var byLength = str ? Math.ceil(str.length / 16) : 1
    lines = Math.max(lines, byBreaks, byLength)
    return Math.max(minH, Math.min(maxH, 42 + lines * 38))
  },

  onFormDate: function (e) {
    this.setData({ 'form.date': e.detail.value, dirty: true })
  },

  onFormTime: function (e) {
    this.setData({ 'form.startTime': e.detail.value, dirty: true })
  },

  onFormAmountQuick: function (e) {
    var v = parseInt(e.currentTarget.dataset.v) || 1
    var max = this.getFormAmountUiLimit()
    if (v > max) {
      wx.showToast({ title: '剩余课时不足', icon: 'none', duration: 2000 })
      this.shakeFormAmount()
      return
    }
    this.setData({
      'form.plannedAmount': v,
      'form.customAmount': '',
      'form.customSelected': false,
      formAmountShake: false,
      formAmountLimit: max,
      dirty: true
    })
  },

  onFormAmountFocus: function () {
    var val = this.data.form.customAmount || ''
    var n = val ? S.parseAmount(val, 0) : ''
    this.setData({
      'form.customSelected': true,
      'form.plannedAmount': n,
      dirty: true
    })
  },

  onFormAmountInput: function (e) {
    var max = this.getFormAmountUiLimit()
    var cleaned = S.cleanHalfAmountInput(e.detail.value, max)
    var val = cleaned.value
    var n = cleaned.amount
    if (cleaned.capped) {
      wx.showToast({ title: '剩余课时不足', icon: 'none', duration: 2000 })
      this.shakeFormAmount()
    } else if (cleaned.invalidHalf) {
      wx.showToast({ title: '只支持半节课', icon: 'none', duration: 1600 })
    }
    this.setData({
      'form.customAmount': val,
      'form.plannedAmount': n,
      'form.customSelected': true,
      formAmountLimit: max,
      dirty: true
    })
  },

  onFormNote: function (e) {
    var val = (e.detail && e.detail.value) || ''
    this._formNoteDraft = val
    if (this.data.noteCount !== val.length || !this.data.dirty) {
      this.setData({ noteCount: val.length, dirty: true })
    }
  },

  onFormNoteBlur: function (e) {
    var val = (e.detail && e.detail.value) || ''
    this._formNoteDraft = val
    this.setData({
      'form.note': val,
      noteCount: val.length,
      dirty: true
    })
  },

  saveForm: function () {
    if (this._saving || this.data.saving) return
    var f = clone(this.data.form)
    if (typeof this._formNoteDraft === 'string') f.note = this._formNoteDraft
    var student = this.getStudent(f.studentId)
    if (!student) { wx.showToast({ title: '请选择学员', icon: 'none' }); return }
    if (!f.date || !f.startTime) { wx.showToast({ title: '请选择日期和时间', icon: 'none' }); return }
    f.plannedAmount = S.parseAmount(f.plannedAmount, 0)
    if (isNaN(f.plannedAmount)) f.plannedAmount = 0
    if (f.plannedAmount <= 0) { wx.showToast({ title: '课时数要大于0', icon: 'none' }); return }
    var oldSchedule = (f.id !== '' && f.id !== null && f.id !== undefined) ? this.getSchedule(f.id) : null
    var oldSameStudent = oldSchedule && oldSchedule.studentId == student.id
    var worsensReserve = !oldSameStudent || f.plannedAmount > S.plannedAmount(oldSchedule)
    var reserved = this.getReservedLessons(student.id, f.id)
    var remaining = S.parseAmount(student.remainingLessons, 0)
    if (reserved + f.plannedAmount > remaining && worsensReserve) {
      wx.showToast({ title: '已排课时超过剩余课时', icon: 'none', duration: 2000 })
      return
    }
    var conflict = this.findStudentTimeConflict(f)
    if (conflict) {
      wx.showToast({ title: '该时间已有排课', icon: 'none', duration: 2000 })
      return
    }
    var that = this
    this._saving = true
    this.setData({ saving: true })
    if (S.toDateTime(f.date, f.startTime).getTime() < Date.now()) {
      this.openConfirmDialog({
        title: '排课时间已过',
        content: '保存后会按当前时间显示为上课中或未消课，确定继续吗？',
        okText: '继续保存'
      }, function () {
        that.commitForm(f, student)
      }, function () {
        that._saving = false
        that.setData({ saving: false })
      })
      return
    }
    this.commitForm(f, student)
  },

  commitForm: function (f, student) {
    var schedules = app.globalData.schedules || []
    var now = Date.now()
    var changedSchedule = null
    if (f.id !== '' && f.id !== null && f.id !== undefined) {
      var saved = false
      for (var i = 0; i < schedules.length; i++) {
        if (schedules[i].id == f.id) {
          if (S.isHidden(schedules[i]) || schedules[i].status !== S.STATUS.SCHEDULED) {
            this._saving = false
            this.setData({ saving: false })
            wx.showToast({ title: '这节排课已变化', icon: 'none', duration: 1800 })
            return
          }
          schedules[i].studentId = student.id
          schedules[i].studentName = student.name
          schedules[i].avatarSrc = student.avatarSrc || '/images/avatars/avatar_1.png'
          schedules[i].date = f.date
          schedules[i].startTime = f.startTime
          schedules[i].plannedAmount = f.plannedAmount
          schedules[i].note = (f.note || '').trim()
          schedules[i].updatedAt = now
          changedSchedule = schedules[i]
          saved = true
          break
        }
      }
      if (!saved) {
        this._saving = false
        this.setData({ saving: false })
        wx.showToast({ title: '这节排课不存在', icon: 'none', duration: 1800 })
        return
      }
    } else {
      changedSchedule = {
        id: app.globalData.nextScheduleId++,
        studentId: student.id,
        studentName: student.name,
        avatarSrc: student.avatarSrc || '/images/avatars/avatar_1.png',
        date: f.date,
        startTime: f.startTime,
        plannedAmount: f.plannedAmount,
        actualAmount: 0,
        type: S.TYPE.SCHEDULED,
        status: S.STATUS.SCHEDULED,
        note: (f.note || '').trim(),
        completeNote: '',
        linkedHistoryTs: 0,
        createdAt: now,
        updatedAt: now,
        deleted: false
      }
      schedules.push(changedSchedule)
    }
    app.globalData.schedules = schedules
    app.save()
    syncScheduleSafe(changedSchedule)
    A.track('schedule_save', { studentId: student.id, amount: f.plannedAmount })
    var targetMonth = S.toDate(f.date)
    var that = this
    this.setData({
      year: targetMonth.getFullYear(),
      month: targetMonth.getMonth() + 1,
      calendarAnchorDate: f.date,
      selectedDate: f.date,
      selectedTitle: S.dateTitle(f.date),
      dirty: false,
      saving: false
    }, function () {
      that._saving = false
      that.showOkText('已保存')
      that.afterSaveForm(f)
    })
  },

  afterSaveForm: function (f) {
    if (this.data.editReturnMode === 'detail' && f.id !== '' && f.id !== null && f.id !== undefined) {
      var s = this.getSchedule(f.id)
      if (s && !S.isHidden(s)) {
        this.openDetail(f.id, this.data.detailSource || (this.data.detailFromRecent ? 'recent' : 'day'))
        return
      }
    }
    this.backToDay()
  },

  deleteSelected: function () {
    var detail = this.data.selectedSchedule
    if (!detail) return
    this.setData({ showScheduleDel: true })
  },

  closeScheduleDel: function () {
    this.setData({ showScheduleDel: false })
  },

  openConfirmDialog: function (opts, onConfirm, onCancel) {
    this._confirmDialogOk = typeof onConfirm === 'function' ? onConfirm : null
    this._confirmDialogCancel = typeof onCancel === 'function' ? onCancel : null
    this.setData({
      showConfirmDialog: true,
      confirmDialogTitle: opts.title || '确认操作',
      confirmDialogContent: opts.content || '',
      confirmDialogOkText: opts.okText || '确定',
      confirmDialogDanger: !!opts.danger
    })
  },

  closeConfirmDialog: function () {
    var cb = this._confirmDialogCancel
    this._confirmDialogOk = null
    this._confirmDialogCancel = null
    this.setData({ showConfirmDialog: false })
    if (cb) cb()
  },

  confirmDialogOk: function () {
    var cb = this._confirmDialogOk
    this._confirmDialogOk = null
    this._confirmDialogCancel = null
    this.setData({ showConfirmDialog: false })
    if (cb) cb()
  },

  doScheduleDel: function () {
    var detail = this.data.selectedSchedule
    if (!detail) {
      this.setData({ showScheduleDel: false })
      return
    }
    var s = this.getSchedule(detail.id)
    if (!s || S.isHidden(s) || s.status !== S.STATUS.SCHEDULED) {
      this.setData({ showScheduleDel: false })
      wx.showToast({ title: '这节排课已变化', icon: 'none', duration: 1800 })
      this.backToDay()
      return
    }
    s.status = S.STATUS.DELETED
    s.deleted = true
    s.deletedAt = U.today()
    s.updatedAt = Date.now()
    app.save()
    syncScheduleSafe(s)
    this.setData({ showScheduleDel: false })
    wx.showToast({ title: '已删除', icon: 'success', duration: 1200 })
    this.backToDay()
  },

  startDeductSelected: function () {
    var d = this.data.selectedSchedule
    if (!d) return
    var remain = S.parseAmount(d.remainingLessons, 0)
    if (remain <= 0) {
      wx.showToast({ title: '学员剩余课时不足', icon: 'none', duration: 1800 })
      return
    }
    var planAmount = S.parseAmount(d.plannedAmount, 1)
    var deductAmount = planAmount > remain ? remain : planAmount
    var customSelected = deductAmount !== 1 && deductAmount !== 2
    var diff = this.calcDeductLessonDiff(deductAmount, planAmount)
    var openedAt = new Date()
    var state = d.state
    var title = state === S.STATE.UPCOMING ? '确认提前消课吗？' : (state === S.STATE.IN_PROGRESS ? '选择消课节数' : '确认排课消课')
    this._deducting = false
    this._deductMoreConfirming = false
    this.setData({
      showDeductModal: true,
      deductTitle: title,
      deductScheduleTimeText: d.dateTitle + ' ' + d.startTime,
      deductAmount: deductAmount,
      deductCustom: customSelected ? S.formatAmount(deductAmount) : '',
      deductCustomSelected: customSelected,
      deductExtraAmount: diff.extra,
      deductLessAmount: diff.less,
      deductConfirmTimeText: state === S.STATE.UPCOMING ? formatCurrentClassTime(openedAt) : '',
      deducting: false
    })
  },

  closeDeductModal: function () {
    this._deducting = false
    this._deductMoreConfirming = false
    this.setData({
      showDeductModal: false,
      deductAmount: 1,
      deductCustom: '',
      deductCustomSelected: false,
      deductExtraAmount: 0,
      deductLessAmount: 0,
      deductConfirmTimeText: '',
      deductScheduleTimeText: '',
      deductTitle: '选择消课节数',
      deducting: false
    })
  },

  onDeductQuick: function (e) {
    var v = parseInt(e.currentTarget.dataset.v) || 1
    var detail = this.data.selectedSchedule
    var remain = S.parseAmount(detail && detail.remainingLessons, 0)
    if (v > remain) { wx.showToast({ title: '学员剩余课时不足', icon: 'none', duration: 1800 }); return }
    var diff = detail ? this.calcDeductLessonDiff(v, detail.plannedAmount) : { extra: 0, less: 0 }
    this.setData({ deductAmount: v, deductCustom: '', deductCustomSelected: false, deductExtraAmount: diff.extra, deductLessAmount: diff.less })
  },

  onDeductCustomFocus: function () {
    var v = S.parseAmount(this.data.deductCustom, 0)
    var detail = this.data.selectedSchedule
    var diff = detail ? this.calcDeductLessonDiff(v, detail.plannedAmount) : { extra: 0, less: 0 }
    this.setData({ deductAmount: v, deductCustomSelected: true, deductExtraAmount: diff.extra, deductLessAmount: diff.less })
  },

  onDeductCustom: function (e) {
    var detail = this.data.selectedSchedule
    var student = detail ? this.getStudent(detail.studentId) : null
    var max = student ? S.parseAmount(student.remainingLessons, 0) : null
    var cleaned = S.cleanHalfAmountInput(e.detail.value, max)
    var v = cleaned.amount
    var val = cleaned.value
    if (cleaned.capped) {
      wx.showToast({ title: '学员剩余课时不足', icon: 'none', duration: 1800 })
    } else if (cleaned.invalidHalf) {
      wx.showToast({ title: '只支持半节课', icon: 'none', duration: 1600 })
    }
    var diff = detail ? this.calcDeductLessonDiff(v, detail.plannedAmount) : { extra: 0, less: 0 }
    this.setData({ deductAmount: v, deductCustom: val, deductCustomSelected: true, deductExtraAmount: diff.extra, deductLessAmount: diff.less })
  },

  calcDeductLessonDiff: function (actual, planned) {
    return S.lessonDiff(actual, planned)
  },

  confirmDeduct: function () {
    if (this._deducting || this._deductMoreConfirming || this.data.deducting) return
    var detail = this.data.selectedSchedule
    if (!detail) return
    var raw = S.parseAmount(this.data.deductAmount, 0)
    var amount = isNaN(raw) ? 0 : raw
    if (amount <= 0) { wx.showToast({ title: '请输入消课节数', icon: 'none' }); return }
    this.completeSchedule(detail.id, amount)
  },

  completeSchedule: function (scheduleId, amount) {
    if (this._deducting || this.data.deducting) return
    this._deducting = true
    this.setData({ deducting: true })
    var s = this.getSchedule(scheduleId)
    if (!s) { this._deducting = false; this.setData({ deducting: false }); return }
    if (s.status === S.STATUS.COMPLETED) {
      this._deducting = false
      this.setData({ deducting: false })
      wx.showToast({ title: '这节课已消课', icon: 'none', duration: 1800 })
      this.backToDay()
      return
    }
    if (S.isHidden(s) || s.status !== S.STATUS.SCHEDULED) {
      this._deducting = false
      this.setData({ deducting: false })
      wx.showToast({ title: '这节排课已变化', icon: 'none', duration: 1800 })
      this.backToDay()
      return
    }
    var student = this.getStudent(s.studentId)
    if (!student) { this._deducting = false; this.setData({ deducting: false }); wx.showToast({ title: '学员不存在', icon: 'none' }); return }
    var remain = S.parseAmount(student.remainingLessons, 0)
    if (amount > remain) { this._deducting = false; this.setData({ deducting: false }); wx.showToast({ title: '学员剩余课时不足', icon: 'none', duration: 1800 }); return }
    var now = Date.now()
    var histTs = now
    var today = U.today()
    var currentTime = U.formatTime()
    var originalScheduleDate = s.date
    var originalScheduleStartTime = s.startTime
    var earlyCompleted = S.stateOf(s, now) === S.STATE.UPCOMING
    s.status = S.STATUS.COMPLETED
    s.actualAmount = amount
    s.earlyCompleted = earlyCompleted
    s.completeNote = earlyCompleted ? '提前消课' : ''
    if (earlyCompleted) {
      s.originalDate = s.originalDate || originalScheduleDate
      s.originalStartTime = s.originalStartTime || originalScheduleStartTime
      s.date = today
      s.startTime = currentTime
    }
    s.completedAt = now
    s.linkedHistoryTs = histTs
    s.beforeRemaining = student.remainingLessons
    s.beforeLastClassDate = student.lastClassDate || ''
    s.updatedAt = now
    student.remainingLessons = Math.max(0, remain - amount)
    student.lastClassDate = s.date
    student.lastModified = now
    student.history = [{
      type: U.REC.DEDUCT,
      amount: amount,
      time: s.date + ' ' + S.formatHM(s.startTime),
      ts: histTs,
      scheduleId: s.id,
      scheduleDate: s.date,
      plannedAmount: S.plannedAmount(s),
      earlyCompleted: earlyCompleted,
      originalScheduleDate: earlyCompleted ? s.originalDate : '',
      originalScheduleTime: earlyCompleted ? S.formatHM(s.originalStartTime) : ''
    }].concat(student.history || [])
    syncStudentSafe(student)
    app.save()
    syncScheduleSafe(s)
    A.track('schedule_deduct', { studentId: student.id, amount: amount })
    this._deducting = false
    this.setData({ deducting: false })
    this.showOkText('消课成功')
    this.backToDay(s.date || this.data.selectedDate, s.id)
  },

  undoSelected: function () {
    var detail = this.data.selectedSchedule
    if (!detail) return
    var that = this
    this.openConfirmDialog({
      title: '撤销消课',
      content: '会恢复学员课时，并删除这条消课记录。',
      okText: '撤销',
      danger: true
    }, function () {
      that.undoSchedule(detail.id)
    })
  },

  undoSchedule: function (scheduleId) {
    var s = this.getSchedule(scheduleId)
    if (!s || s.status !== S.STATUS.COMPLETED) return
    var student = this.getStudent(s.studentId)
    if (!student) return
    var now = Date.now()
    var amount = S.parseAmount(s.actualAmount, 0) || S.plannedAmount(s)
    student.remainingLessons = s.beforeRemaining !== undefined ? s.beforeRemaining : (S.parseAmount(student.remainingLessons, 0) + amount)
    student.lastClassDate = s.beforeLastClassDate || ''
    var nh = []
    for (var i = 0; i < (student.history || []).length; i++) {
      var h = student.history[i]
      if (s.linkedHistoryTs && h.ts === s.linkedHistoryTs) continue
      nh.push(h)
    }
    student.history = nh
    student.lastModified = now
    student.updatedAt = now
    s.status = S.STATUS.DELETED
    s.deleted = true
    s.deletedAt = U.today()
    s.actualAmount = 0
    s.earlyCompleted = false
    s.completeNote = ''
    s.completedAt = 0
    s.linkedHistoryTs = 0
    s.updatedAt = now
    syncStudentSafe(student)
    app.save()
    syncScheduleSafe(s)
    this.showOkText('已撤销')
    this.backToDay()
  },

  nop: function () {}
})
