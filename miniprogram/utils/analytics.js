var C = null
try { C = require('./cloud.js') } catch (e) { C = null }

var LOCAL_KEY = '_analytics'
var _batch = []

// 记录事件
function track(event, extra) {
  var entry = {
    event: event,
    time: formatTime(),
    date: today(),
    ts: Date.now()
  }
  if (extra) entry.extra = extra

  // 存本地
  try {
    var list = wx.getStorageSync(LOCAL_KEY) || []
    list.push(entry)
    // 只保留最近1000条
    if (list.length > 1000) list = list.slice(-1000)
    wx.setStorageSync(LOCAL_KEY, list)
  } catch (e) {}

  // 攒够10条或每30秒同步一次到云端
  _batch.push(entry)
  if (_batch.length >= 10) flushToCloud()
  scheduleFlush()
}

function formatTime() {
  var d = new Date()
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds())
}

function today() {
  var d = new Date()
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
}

function p2(n) { return (n < 10 ? '0' : '') + n }

var _flushTimer = null
function scheduleFlush() {
  if (_flushTimer) return
  _flushTimer = setTimeout(function () {
    _flushTimer = null
    flushToCloud()
  }, 30000)
}

function flushToCloud() {
  if (!_batch.length) return
  if (!C || !C.isReady()) { _batch = []; return }
  var items = _batch.slice()
  _batch = []
  for (var i = 0; i < items.length; i++) {
    C.trackEvent(items[i])
  }
}

module.exports = { track: track }
