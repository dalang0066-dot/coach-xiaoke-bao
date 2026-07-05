var U = require('./util.js')

// 云开发环境ID（开通云开发后替换为实际值）
var ENV_ID = 'cloud1-d3g6bbdp839f36607'

// 离线操作队列（存储待同步到云端的操作）
var OFFLINE_QUEUE_KEY = '_offline_queue'

var _inited = false
var _db = null
var _online = true

// ===== 初始化 =====
function init() {
  if (_inited) return
  _inited = true
  try {
    if (ENV_ID && wx.cloud) {
      wx.cloud.init({ env: ENV_ID, traceUser: true })
      _db = wx.cloud.database()
      checkNetwork()
      wx.onNetworkStatusChange(function (res) {
        _online = res.isConnected
        if (_online) flushQueue()
      })
    }
  } catch (e) { _db = null }
}

function isReady() { return !!_db }

// ===== 网络检测 =====
function checkNetwork() {
  try {
    wx.getNetworkType({
      success: function (res) { _online = res.networkType !== 'none' }
    })
  } catch (e) { _online = true }
}

function isOnline() { return _online }

// ===== 离线队列 =====
function queueOp(type, data) {
  try {
    if (type === 'saveSchedule') ensureScheduleLocalKey(data)
    var q = wx.getStorageSync(OFFLINE_QUEUE_KEY) || []
    q.push({ type: type, data: data, ts: Date.now() })
    wx.setStorageSync(OFFLINE_QUEUE_KEY, q)
  } catch (e) {}
}

function flushQueue() {
  try {
    if (!_db) return
    var q = wx.getStorageSync(OFFLINE_QUEUE_KEY) || []
    if (!q.length) return
    var remaining = []
    var pending = q.length
    wx.setStorageSync(OFFLINE_QUEUE_KEY, [])
    var finish = function (op, err) {
      if (err) remaining.push(op)
      pending--
      if (pending <= 0) {
        var latest = wx.getStorageSync(OFFLINE_QUEUE_KEY) || []
        wx.setStorageSync(OFFLINE_QUEUE_KEY, remaining.concat(latest))
      }
    }
    for (var i = 0; i < q.length; i++) {
      (function (op) {
        if (op.type === 'save') {
          syncStudent(op.data, function (err) { finish(op, err) })
        } else if (op.type === 'saveSchedule') {
          syncSchedule(op.data, function (err) { finish(op, err) })
        } else {
          finish(op, true)
        }
      })(q[i])
    }
  } catch (e) {}
}

function syncSchedule(schedule, cb) {
  if (!_db) { if (cb) cb(null); return }
  ensureScheduleLocalKey(schedule)
  var coll = _db.collection('schedules')
  var docId = schedule._cloudId
  var studentCloudId = ''
  try {
    var app = getApp()
    var students = (app && app.globalData && app.globalData.students) ? app.globalData.students : []
    for (var si = 0; si < students.length; si++) {
      if (students[si] && students[si].id == schedule.studentId) {
        studentCloudId = students[si]._cloudId || ''
        break
      }
    }
  } catch (e) {}
  var data = {
    id: schedule.id,
    localKey: schedule.localKey,
    studentId: schedule.studentId,
    studentCloudId: schedule.studentCloudId || studentCloudId,
    studentName: schedule.studentName || '',
    avatarSrc: schedule.avatarSrc || '',
    date: schedule.date,
    startTime: schedule.startTime,
    plannedAmount: schedule.plannedAmount,
    actualAmount: schedule.actualAmount || 0,
    note: schedule.note || '',
    completeNote: schedule.completeNote || '',
    type: schedule.type || '',
    status: schedule.status || '',
    deleted: schedule.deleted || false,
    deletedAt: schedule.deletedAt || '',
    earlyCompleted: !!schedule.earlyCompleted,
    originalDate: schedule.originalDate || '',
    originalStartTime: schedule.originalStartTime || '',
    completedAt: schedule.completedAt || 0,
    linkedHistoryTs: schedule.linkedHistoryTs || 0,
    createdAt: schedule.createdAt || '',
    updatedAt: schedule.updatedAt || Date.now()
  }
  if (docId) {
    coll.doc(docId).update({ data: data })
      .then(function () { if (cb) cb(null) })
      .catch(function (e) { if (cb) cb(e) })
  } else {
    coll.where({ localKey: data.localKey }).get()
      .then(function (res) {
        if (res.data && res.data.length) {
          schedule._cloudId = res.data[0]._id
          coll.doc(schedule._cloudId).update({ data: data })
            .then(function () {
              try { getApp().save() } catch (e) {}
              if (cb) cb(null)
            })
            .catch(function (e) { if (cb) cb(e) })
        } else {
          coll.add({ data: data })
            .then(function (addRes) {
              schedule._cloudId = addRes._id
              try { getApp().save() } catch (e) {}
              if (cb) cb(null)
            })
            .catch(function (e) { if (cb) cb(e) })
        }
      })
      .catch(function (e) { if (cb) cb(e) })
  }
}

function pullSchedules(cb) {
  if (!_db) { if (cb) cb(null); return }
  _db.collection('schedules').where({ _openid: '{openid}' }).get()
    .then(function (res) {
      var list = []
      for (var i = 0; i < res.data.length; i++) {
        var d = res.data[i]
        d._cloudId = d._id
        list.push(d)
      }
      if (cb) cb(list)
    })
    .catch(function () { if (cb) cb(null) })
}

function getQueueLength() {
  try { return (wx.getStorageSync(OFFLINE_QUEUE_KEY) || []).length } catch (e) { return 0 }
}

// ===== 学生数据同步 =====
function syncStudent(student, cb) {
  if (!_db) { if (cb) cb(null); return }
  var coll = _db.collection('students')
  var docId = student._cloudId
  var data = {
    studentLocalId: student.id,
    name: student.name,
    avatarSrc: student.avatarSrc,
    totalLessons: student.totalLessons,
    remainingLessons: student.remainingLessons,
    expiryDate: student.expiryDate,
    note: student.note,
    lastClassDate: student.lastClassDate,
    lastModified: student.lastModified,
    history: student.history,
    deleted: student.deleted || false,
    deletedAt: student.deletedAt || '',
    createdAt: student.createdAt || U.today()
  }
  if (docId) {
    coll.doc(docId).update({ data: data })
      .then(function () { if (cb) cb(null) })
      .catch(function (e) { if (cb) cb(e) })
  } else {
    coll.add({ data: data })
      .then(function (res) {
        student._cloudId = res._id
        try { getApp().save() } catch (e) {}
        if (cb) cb(null)
      })
      .catch(function (e) { if (cb) cb(e) })
  }
}

function syncAll(students, cb) {
  if (!_db) { if (cb) cb(null); return }
  var done = 0, total = students.length
  if (!total) { if (cb) cb(null); return }
  for (var i = 0; i < students.length; i++) {
    syncStudent(students[i], function () {
      done++; if (done >= total && cb) cb(null)
    })
  }
}

// ===== 云端拉取 =====
function pullFromCloud(cb) {
  if (!_db) { if (cb) cb(null); return }
  _db.collection('students').where({ _openid: '{openid}' }).get()
    .then(function (res) {
      var list = []
      for (var i = 0; i < res.data.length; i++) {
        var d = res.data[i]
        d._cloudId = d._id
        list.push(d)
      }
      if (cb) cb(list)
    })
    .catch(function (e) {
      console.log('云同步拉取失败:', e)
      if (cb) cb(null)
    })
}

// ===== 会员状态同步 =====
function syncMember(isPro, memberExpired, proExpiry, upgradeShown, cb) {
  if (!_db) { if (cb) cb(null); return }
  var app = getApp()
  var realOpenid = (app && app.globalData && app.globalData._realOpenid) ? app.globalData._realOpenid : ''
  if (!realOpenid) { if (cb) cb('no_openid'); return } // openid还没拿到，暂时跳过
  _db.collection('users').where({ openid: realOpenid }).get()
    .then(function (res) {
      var data = { openid: realOpenid, isProMember: isPro, memberExpired: memberExpired, proExpiry: proExpiry || '', upgradeShown: !!upgradeShown }
      if (res.data.length) {
        _db.collection('users').doc(res.data[0]._id).update({ data: data })
          .then(function () { if (cb) cb(null) })
          .catch(function (e) { if (cb) cb(e) })
      } else {
        _db.collection('users').add({ data: data })
          .then(function () { if (cb) cb(null) })
          .catch(function (e) { if (cb) cb(e) })
      }
    })
    .catch(function (e) { if (cb) cb(e) })
}

function ensureScheduleLocalKey(schedule) {
  if (!schedule) return ''
  if (!schedule.localKey) {
    var seed = [
      schedule.id !== undefined && schedule.id !== null ? schedule.id : 'x',
      schedule.createdAt || schedule.updatedAt || Date.now(),
      schedule.studentId !== undefined && schedule.studentId !== null ? schedule.studentId : 's'
    ].join('_')
    schedule.localKey = 'schedule_' + seed
  }
  return schedule.localKey
}

function pullMember(cb) {
  if (!_db) { if (cb) cb(null, null, null, null, null, null); return }
  var app = getApp()
  var realOpenid = (app && app.globalData && app.globalData._realOpenid) ? app.globalData._realOpenid : ''
  if (!realOpenid) { if (cb) cb(null, null, null, null, null, null); return }
  _db.collection('users').where({ openid: realOpenid }).get()
    .then(function (res) {
      if (res.data.length) {
        var d = res.data[0]
        if (cb) cb(d.isProMember, d.memberExpired, d.proExpiry || '', d.welcomeReward || 0, d.pendingReward || 0, d.upgradeShown || false)
      } else {
        if (cb) cb(false, false, '', 0, 0, false)
      }
    })
    .catch(function () { if (cb) cb(null, null, null, null, null, null) })
}

function clearRewardFlags(cb) {
  if (!_db) { if (cb) cb(); return }
  var app = getApp()
  var realOpenid = (app && app.globalData && app.globalData._realOpenid) ? app.globalData._realOpenid : ''
  if (!realOpenid) { if (cb) cb(); return }
  _db.collection('users').where({ openid: realOpenid }).get()
    .then(function (res) {
      if (res.data.length) {
        _db.collection('users').doc(res.data[0]._id).update({
          data: { welcomeReward: 0, pendingReward: 0 }
        }).then(function () { if (cb) cb() }).catch(function () { if (cb) cb() })
      } else { if (cb) cb() }
    })
    .catch(function () { if (cb) cb() })
}

// ===== 彩蛋标记 =====
function syncEasterClaimed() {
  if (!_db) return
  var app = getApp()
  var realOpenid = (app && app.globalData && app.globalData._realOpenid) ? app.globalData._realOpenid : ''
  var coll = _db.collection('users')
  var data = { easterClaimed: true, easterProExpiry: '' }
  if (realOpenid) data.openid = realOpenid
  var saveClaimed = function (res) {
    if (res.data.length) {
      coll.doc(res.data[0]._id).update({ data: data })
    } else {
      coll.add({ data: data })
    }
  }
  var query = realOpenid ? coll.where({ openid: realOpenid }) : coll.where({ _openid: '{openid}' })
  query.get()
    .then(function (res) {
      if (res.data.length) {
        saveClaimed(res)
      } else if (realOpenid) {
        coll.where({ _openid: '{openid}' }).get()
          .then(saveClaimed)
          .catch(function () { coll.add({ data: data }) })
      } else {
        saveClaimed(res)
      }
    })
    .catch(function () {})
}

function pullEasterClaimed(cb) {
  if (!_db) { if (cb) cb(false); return }
  var app = getApp()
  var realOpenid = (app && app.globalData && app.globalData._realOpenid) ? app.globalData._realOpenid : ''
  var coll = _db.collection('users')
  var checkClaimed = function (res) {
    if (res.data.length && res.data[0].easterClaimed) {
      if (cb) cb(true)
    } else {
      if (cb) cb(false)
    }
  }
  var query = realOpenid ? coll.where({ openid: realOpenid }) : coll.where({ _openid: '{openid}' })
  query.get()
    .then(function (res) {
      if (res.data.length && res.data[0].easterClaimed) {
        if (cb) cb(true)
      } else if (!realOpenid) {
        checkClaimed(res)
      } else {
        coll.where({ _openid: '{openid}' }).get()
          .then(checkClaimed)
          .catch(function () { if (cb) cb(false) })
      }
    })
    .catch(function () { if (cb) cb(false) })
}

// ===== 意见反馈 =====
function submitFeedback(content, contact, images, cb) {
  if (!_db) { if (cb) cb('cloud_unavailable'); return }
  _db.collection('feedback').add({
    data: { content: content, contact: contact || '', images: images || [], time: new Date().toISOString() }
  }).then(function () { if (cb) cb(null) })
    .catch(function (e) { if (cb) cb(e) })
}

// ===== 埋点 =====
function trackEvent(entry) {
  if (!_db) return
  _db.collection('analytics').add({ data: entry })
    .catch(function () {})
}

// ===== 分享推荐 =====
function processReferral(referrerId, cb) {
  if (!_db) { if (cb) cb('cloud_unavailable'); return }
  wx.cloud.callFunction({
    name: 'processReferral',
    data: { referrerId: referrerId }
  }).then(function (res) {
    if (cb) cb(res.result && res.result.code === 0 ? null : (res.result && res.result.msg || 'referral_error'), res.result)
  }).catch(function (e) {
    if (cb) cb(e.errMsg || 'referral_error')
  })
}

// ===== 支付 =====
function pay(plan, cb) {
  if (!_db) { if (cb) cb('cloud_unavailable'); return }
  wx.cloud.callFunction({
    name: 'payOrder',
    data: { plan: plan }
  }).then(function (res) {
    var payResult = res.result
    if (!payResult || payResult.code !== 0 || !payResult.payment) {
      if (cb) cb('pay_error')
      return
    }
    var p = payResult.payment
    wx.requestPayment({
      timeStamp: p.timeStamp,
      nonceStr: p.nonceStr,
      package: p.package,
      signType: p.signType || 'RSA',
      paySign: p.paySign,
      success: function () { if (cb) cb(null) },
      fail: function (e) {
        if (cb) cb(e.errMsg || 'pay_cancel')
      }
    })
  }).catch(function (e) {
    if (cb) cb(e.errMsg || 'pay_error')
  })
}

module.exports = {
  init: init,
  isReady: isReady,
  isOnline: isOnline,
  checkNetwork: checkNetwork,
  syncStudent: syncStudent,
  syncSchedule: syncSchedule,
  ensureScheduleLocalKey: ensureScheduleLocalKey,
  pullSchedules: pullSchedules,
  syncAll: syncAll,
  pullFromCloud: pullFromCloud,
  syncMember: syncMember,
  pullMember: pullMember,
  clearRewardFlags: clearRewardFlags,
  queueOp: queueOp,
  flushQueue: flushQueue,
  getQueueLength: getQueueLength,
  pay: pay,
  syncEasterClaimed: syncEasterClaimed,
  pullEasterClaimed: pullEasterClaimed,
  trackEvent: trackEvent,
  processReferral: processReferral,
  submitFeedback: submitFeedback
}
