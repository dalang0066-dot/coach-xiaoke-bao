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
    var q = wx.getStorageSync(OFFLINE_QUEUE_KEY) || []
    q.push({ type: type, data: data, ts: Date.now() })
    wx.setStorageSync(OFFLINE_QUEUE_KEY, q)
  } catch (e) {}
}

function flushQueue() {
  try {
    var q = wx.getStorageSync(OFFLINE_QUEUE_KEY) || []
    if (!q.length) return
    var remaining = []
    for (var i = 0; i < q.length; i++) {
      var op = q[i]
      if (op.type === 'save') {
        syncStudent(op.data, function (err) { if (err) remaining.push(op) })
      }
    }
    wx.setStorageSync(OFFLINE_QUEUE_KEY, remaining)
  } catch (e) {}
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
function syncMember(isPro, memberExpired, proExpiry) {
  if (!_db) return
  _db.collection('users').where({ _openid: '{openid}' }).get()
    .then(function (res) {
      var data = { openid: '{openid}', isProMember: isPro, memberExpired: memberExpired, proExpiry: proExpiry || '' }
      if (res.data.length) {
        _db.collection('users').doc(res.data[0]._id).update({ data: data })
      } else {
        _db.collection('users').add({ data: data })
      }
    })
    .catch(function () {})
}

function pullMember(cb) {
  if (!_db) { if (cb) cb(null, null, null, null, null); return }
  _db.collection('users').where({ _openid: '{openid}' }).get()
    .then(function (res) {
      if (res.data.length) {
        var d = res.data[0]
        if (cb) cb(d.isProMember, d.memberExpired, d.proExpiry || '', d.welcomeReward || 0, d.pendingReward || 0)
      } else {
        if (cb) cb(false, false, '', 0, 0)
      }
    })
    .catch(function () { if (cb) cb(null, null, null, null, null) })
}

function clearRewardFlags(cb) {
  if (!_db) { if (cb) cb(); return }
  _db.collection('users').where({ _openid: '{openid}' }).get()
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
  _db.collection('users').where({ _openid: '{openid}' }).get()
    .then(function (res) {
      var data = { easterClaimed: true, easterProExpiry: '' }
      // 这里 easterProExpiry 由调用方填入实际日期
      if (res.data.length) {
        _db.collection('users').doc(res.data[0]._id).update({ data: data })
      } else {
        _db.collection('users').add({ data: data })
      }
    })
    .catch(function () {})
}

function pullEasterClaimed(cb) {
  if (!_db) { if (cb) cb(false); return }
  _db.collection('users').where({ _openid: '{openid}' }).get()
    .then(function (res) {
      if (res.data.length && res.data[0].easterClaimed) {
        if (cb) cb(true)
      } else {
        if (cb) cb(false)
      }
    })
    .catch(function () { if (cb) cb(false) })
}

// ===== 意见反馈 =====
function submitFeedback(content, contact, cb) {
  if (!_db) { if (cb) cb('cloud_unavailable'); return }
  _db.collection('feedback').add({
    data: { content: content, contact: contact || '', time: new Date().toISOString() }
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
    if (cb) cb(res.result && res.result.code === 0 ? null : (res.result && res.result.msg || 'referral_error'))
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
    console.log('云函数返回:', JSON.stringify(payResult))
    if (!payResult || payResult.code !== 0 || !payResult.payment) {
      console.log('支付参数异常，缺少payment对象')
      if (cb) cb('pay_error')
      return
    }
    var p = payResult.payment
    console.log('支付参数:', JSON.stringify({ ts: p.timeStamp, ns: p.nonceStr, pk: p.package, st: p.signType, ps: p.paySign }))
    wx.requestPayment({
      timeStamp: p.timeStamp,
      nonceStr: p.nonceStr,
      package: p.package,
      signType: p.signType || 'RSA',
      paySign: p.paySign,
      success: function () { if (cb) cb(null) },
      fail: function (e) {
        console.log('支付拉起失败:', e.errMsg)
        if (cb) cb(e.errMsg || 'pay_cancel')
      }
    })
  }).catch(function (e) {
    console.log('云函数调用失败:', e.errMsg)
    if (cb) cb(e.errMsg || 'pay_error')
  })
}

module.exports = {
  init: init,
  isReady: isReady,
  isOnline: isOnline,
  checkNetwork: checkNetwork,
  syncStudent: syncStudent,
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
