var U = require('./util.js')

// 云开发环境ID（开通云开发后替换为实际值）
var ENV_ID = 'cloud1-d3g6bbdp839f36607'

// 离线操作队列（存储待同步到云端的操作）
var OFFLINE_QUEUE_KEY = '_offline_queue'

var _inited = false
var _db = null
var _online = true
var PAGE_SIZE = 20
var QUEUE_BATCH_SIZE = 20
var _flushing = false
var _studentSyncing = {}
var _scheduleSyncing = {}

function makeUid(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
}

function hashText(text) {
  var str = String(text || '')
  var hash = 0
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

function legacyStudentKey(data) {
  if (!data) return ''
  var localId = data.studentLocalId !== undefined && data.studentLocalId !== null ? data.studentLocalId : data.id
  if (localId === undefined || localId === null || localId === '' || !data.createdAt || !data.name) return ''
  return localId + '|' + data.createdAt + '|' + hashText(data.name)
}

function isCloudDerivedStudentUid(uid) {
  return !!(uid && String(uid).indexOf('stu_cloud_') === 0)
}

function isCloudDerivedScheduleUid(uid) {
  return !!(uid && String(uid).indexOf('sch_cloud_') === 0)
}

// ===== 初始化 =====
function init() {
  if (_inited && _db) return
  try {
    if (ENV_ID && wx.cloud && wx.cloud.init && wx.cloud.database) {
      wx.cloud.init({ env: ENV_ID })
      _db = wx.cloud.database()
      _inited = true
      checkNetwork()
      if (wx.onNetworkStatusChange) {
        try {
          wx.onNetworkStatusChange(function (res) {
            _online = res.isConnected
            if (_online) flushQueue()
          })
        } catch (e) {}
      }
    }
  } catch (e) { _db = null; _inited = false }
}

function isReady() { return !!_db }

function getRealOpenid() {
  try {
    var app = getApp()
    return (app && app.globalData && app.globalData._realOpenid) ? app.globalData._realOpenid : ''
  } catch (e) {
    return ''
  }
}

function uniqueDocs() {
  var map = {}, list = []
  for (var a = 0; a < arguments.length; a++) {
    var arr = arguments[a] || []
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i]
      if (!item || !item._id || map[item._id]) continue
      map[item._id] = true
      list.push(item)
    }
  }
  return list
}

function studentIdentity(data) {
  if (!data) return ''
  var legacy = legacyStudentKey(data)
  if (data.studentUid && !isCloudDerivedStudentUid(data.studentUid)) return 'studentUid:' + data.studentUid
  if (legacy) return 'legacyLocal:' + legacy
  if (data.studentUid) return 'studentUid:' + data.studentUid
  if (data._cloudId || data._id) return 'cloud:' + (data._cloudId || data._id)
  return ''
}

function newerStudent(a, b) {
  if (!a) return b
  if (!b) return a
  var at = a.updatedAt || a.lastModified || 0
  var bt = b.updatedAt || b.lastModified || 0
  if (bt > at) return b
  if (bt < at) return a
  var ah = (a.history || []).length
  var bh = (b.history || []).length
  if (bh > ah) return b
  if (a.deleted && !b.deleted) return b
  return a
}

function dedupeStudentDocs(docs) {
  var map = {}, order = [], list = []
  docs = docs || []
  for (var i = 0; i < docs.length; i++) {
    var d = docs[i]
    if (!d) continue
    var key = studentIdentity(d) || ('cloud:' + (d._id || i))
    if (!map[key]) order.push(key)
    map[key] = newerStudent(map[key], d)
  }
  for (var j = 0; j < order.length; j++) {
    list.push(map[order[j]])
  }
  return list
}

function scheduleIdentity(data) {
  if (!data) return ''
  if (data.scheduleUid && !isCloudDerivedScheduleUid(data.scheduleUid)) return 'scheduleUid:' + data.scheduleUid
  if (data.localKey) return 'localKey:' + data.localKey
  var id = data.id !== undefined && data.id !== null ? data.id : ''
  var studentId = data.studentId !== undefined && data.studentId !== null ? data.studentId : ''
  if (id !== '' && studentId !== '' && data.createdAt) return 'created:' + id + '|' + studentId + '|' + data.createdAt
  var studentKey = data.studentUid || data.studentCloudId || studentId || ''
  var slot = [studentKey, data.date || '', data.startTime || '', data.type || '', data.linkedHistoryTs || '', data.plannedAmount || ''].join('|')
  if (slot.replace(/\|/g, '')) return 'slot:' + slot
  if (data.scheduleUid) return 'scheduleUid:' + data.scheduleUid
  if (data._cloudId || data._id) return 'cloud:' + (data._cloudId || data._id)
  return ''
}

function scheduleRank(s) {
  if (!s) return 0
  if (s.deleted || s.status === 'deleted') return 4
  if (s.status === 'completed') return 3
  if (s.status === 'canceled') return 2
  return 1
}

function scheduleTimeScore(s) {
  if (!s) return 0
  var vals = [s.updatedAt, s.completedAt, s.createdAt]
  var max = 0
  for (var i = 0; i < vals.length; i++) {
    var n = parseInt(vals[i])
    if (!isNaN(n) && n > max) max = n
  }
  return max
}

function newerSchedule(a, b) {
  if (!a) return b
  if (!b) return a
  var at = scheduleTimeScore(a)
  var bt = scheduleTimeScore(b)
  if (bt > at) return b
  if (bt < at) return a
  var ar = scheduleRank(a)
  var br = scheduleRank(b)
  if (br > ar) return b
  return a
}

function dedupeScheduleDocs(docs) {
  var map = {}, order = [], list = []
  docs = docs || []
  for (var i = 0; i < docs.length; i++) {
    var d = docs[i]
    if (!d) continue
    var key = scheduleIdentity(d) || ('cloud:' + (d._id || i))
    if (!map[key]) order.push(key)
    map[key] = newerSchedule(map[key], d)
  }
  for (var j = 0; j < order.length; j++) {
    list.push(map[order[j]])
  }
  return list
}

function scheduleSlotIdentity(data) {
  if (!data) return ''
  var studentKey = data.studentUid || data.studentCloudId || data.studentId || ''
  var slot = [studentKey, data.date || '', data.startTime || '', data.type || '', data.linkedHistoryTs || '', data.plannedAmount || ''].join('|')
  return slot.replace(/\|/g, '') ? 'slot:' + slot : ''
}

function dedupeScheduleDocsBySlot(docs) {
  var map = {}, order = [], list = []
  docs = docs || []
  for (var i = 0; i < docs.length; i++) {
    var d = docs[i]
    if (!d) continue
    var key = scheduleIdentity(d) || scheduleSlotIdentity(d) || ('idx:' + i)
    if (!map[key]) order.push(key)
    map[key] = newerSchedule(map[key], d)
  }
  for (var j = 0; j < order.length; j++) list.push(map[order[j]])
  return list
}

function ensureStudentUid(student) {
  if (!student) return ''
  if (!student.studentUid) {
    var legacy = legacyStudentKey(student)
    if (legacy) student.studentUid = 'stu_legacy_' + legacy.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 80)
    else if (student._cloudId || student._id) student.studentUid = 'stu_cloud_' + (student._cloudId || student._id)
    else student.studentUid = makeUid('stu')
  }
  return student.studentUid
}

function ensureScheduleUid(item) {
  if (!item) return ''
  if (!item.scheduleUid) {
    if (item.localKey) item.scheduleUid = 'sch_' + item.localKey
    else if (item._cloudId || item._id) item.scheduleUid = 'sch_cloud_' + (item._cloudId || item._id)
    else item.scheduleUid = makeUid('sch')
  }
  return item.scheduleUid
}

function ensureHistoryUid(rec) {
  if (!rec) return ''
  if (!rec.recordUid) {
    var base = historyIdentity(rec)
    rec.recordUid = base ? ('rec_' + encodeURIComponent(base).replace(/%/g, '').slice(0, 80)) : makeUid('rec')
  }
  return rec.recordUid
}

function normalizeHistory(history) {
  var map = {}, order = [], list = []
  history = history || []
  for (var i = 0; i < history.length; i++) {
    var rec = history[i]
    if (!rec) continue
    ensureHistoryUid(rec)
    var key = historyIdentity(rec)
    if (!key) {
      list.push(rec)
      continue
    }
    if (!map[key]) order.push(key)
    map[key] = newerHistory(map[key], rec)
  }
  for (var j = 0; j < order.length; j++) list.push(map[order[j]])
  list.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0) })
  return list
}

function mergeHistory(a, b) {
  return normalizeHistory((a || []).concat(b || []))
}

function mergeStudentData(existing, incoming) {
  if (!existing) return incoming
  if (!incoming) return existing
  ensureStudentUid(existing)
  ensureStudentUid(incoming)
  var merged = {}
  var cloudNewer = (existing.updatedAt || existing.lastModified || 0) > (incoming.updatedAt || incoming.lastModified || 0)
  var base = cloudNewer ? existing : incoming
  var other = cloudNewer ? incoming : existing
  var keys = ['openid', 'studentUid', 'studentLocalId', 'name', 'avatarSrc', 'totalLessons', 'remainingLessons', 'expiryDate', 'note', 'lastClassDate', 'lastModified', 'deleted', 'deletedAt', 'createdAt', 'updatedAt']
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]
    merged[k] = base[k] !== undefined && base[k] !== null ? base[k] : other[k]
  }
  merged.history = mergeHistory(existing.history || [], incoming.history || [])
  merged.lastModified = Math.max(existing.lastModified || 0, incoming.lastModified || 0)
  merged.updatedAt = Math.max(existing.updatedAt || existing.lastModified || 0, incoming.updatedAt || incoming.lastModified || 0)
  return merged
}

function applySyncedStudent(student, data) {
  if (!student || !data) return
  var keys = ['studentUid', 'name', 'avatarSrc', 'totalLessons', 'remainingLessons', 'expiryDate', 'note', 'lastClassDate', 'lastModified', 'history', 'deleted', 'deletedAt', 'createdAt', 'updatedAt']
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]
    if (data[k] !== undefined && data[k] !== null) student[k] = data[k]
  }
}

function historyIdentity(rec) {
  if (!rec) return ''
  if (rec.recordUid) return 'recordUid:' + rec.recordUid
  if (rec.opId) return 'opId:' + rec.opId
  var type = rec.type || ''
  if (rec.scheduleId !== undefined && rec.scheduleId !== null && rec.scheduleId !== '') {
    return [type, 'schedule', rec.scheduleId, rec.scheduleDate || '', rec.originalScheduleDate || ''].join('|')
  }
  if (rec.ts) return [type, 'ts', rec.ts, rec.amount || ''].join('|')
  return [type, rec.time || '', rec.amount || ''].join('|')
}

function newerHistory(a, b) {
  if (!a) return b
  if (!b) return a
  return (b.ts || 0) >= (a.ts || 0) ? b : a
}

function fetchAll(coll, where, offset, list) {
  list = list || []
  offset = offset || 0
  return coll.where(where).skip(offset).limit(PAGE_SIZE).get()
    .then(function (res) {
      var data = res.data || []
      list = list.concat(data)
      if (data.length >= PAGE_SIZE) return fetchAll(coll, where, offset + PAGE_SIZE, list)
      return list
    })
}

function fetchOwned(collName) {
  var coll = _db.collection(collName)
  var realOpenid = getRealOpenid()
  var tasks = []
  if (realOpenid) {
    tasks.push(fetchAll(coll, { openid: realOpenid }).catch(function () { return [] }))
    tasks.push(fetchAll(coll, { _openid: realOpenid }).catch(function () { return [] }))
  }
  tasks.push(fetchAll(coll, { _openid: '{openid}' }).catch(function () { return [] }))
  return Promise.all(tasks).then(function (res) {
    return uniqueDocs.apply(null, res)
  })
}

function fetchOwnedSince(collName, since) {
  if (!since) return fetchOwned(collName)
  var coll = _db.collection(collName)
  var realOpenid = getRealOpenid()
  var cmd = _db.command
  var tasks = []
  if (realOpenid) {
    tasks.push(fetchAll(coll, { openid: realOpenid, updatedAt: cmd.gt(since) }).catch(function () { return [] }))
  }
  return Promise.all(tasks).then(function (res) {
    return uniqueDocs.apply(null, res)
  })
}

function watchOwned(collName, since, cb, onError) {
  if (!_db || !getRealOpenid()) return null
  try {
    var cmd = _db.command
    var where = { openid: getRealOpenid() }
    if (since) where.updatedAt = cmd.gt(since)
    return _db.collection(collName).where(where).watch({
      onChange: function (snapshot) {
        var docs = []
        if (snapshot && snapshot.docs && snapshot.docs.length) {
          docs = snapshot.docs
        } else if (snapshot && snapshot.docChanges && snapshot.docChanges.length) {
          for (var i = 0; i < snapshot.docChanges.length; i++) {
            if (snapshot.docChanges[i] && snapshot.docChanges[i].doc) docs.push(snapshot.docChanges[i].doc)
          }
        }
        if (docs.length && cb) cb(docs)
      },
      onError: function (err) {
        if (onError) onError(err)
      }
    })
  } catch (e) {
    if (onError) onError(e)
    return null
  }
}

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
function opKey(op) {
  var type = op && op.type ? op.type : ''
  var data = op && op.data ? op.data : {}
  if (type === 'saveSchedule') return type + ':' + (data.scheduleUid || data._cloudId || data.localKey || data.id || '')
  if (type === 'save') return type + ':' + (data.studentUid || data._cloudId || data.studentLocalId || data.id || '')
  return type + ':' + (op && op.ts ? op.ts : Date.now())
}

function compactQueue(q) {
  var seen = {}, list = []
  q = q || []
  for (var i = q.length - 1; i >= 0; i--) {
    var key = opKey(q[i])
    if (!key || seen[key]) continue
    seen[key] = true
    list.unshift(q[i])
  }
  return list
}

function markDirty(item) {
  if (!item) return
  item._dirty = true
  item._syncFailCount = (item._syncFailCount || 0) + 1
  item._lastSyncErrorAt = Date.now()
}

function markSynced(item) {
  if (!item) return
  item._dirty = false
  item._syncFailCount = 0
  item._lastSyncAt = Date.now()
  item._lastSyncErrorAt = 0
}

function queueOp(type, data) {
  try {
    if (type === 'save') ensureStudentUid(data)
    if (type === 'saveSchedule') ensureScheduleLocalKey(data)
    if (type === 'saveSchedule') ensureScheduleUid(data)
    markDirty(data)
    var q = wx.getStorageSync(OFFLINE_QUEUE_KEY) || []
    q.push({ type: type, data: data, ts: Date.now() })
    wx.setStorageSync(OFFLINE_QUEUE_KEY, compactQueue(q))
  } catch (e) {}
}

function flushQueue() {
  try {
    if (!_db || _flushing) return
    var q = compactQueue(wx.getStorageSync(OFFLINE_QUEUE_KEY) || [])
    if (!q.length) return
    _flushing = true
    var batch = q.slice(0, QUEUE_BATCH_SIZE)
    var tail = q.slice(QUEUE_BATCH_SIZE)
    var remaining = []
    var pending = batch.length
    wx.setStorageSync(OFFLINE_QUEUE_KEY, tail)
    var finish = function (op, err) {
      if (err) remaining.push(op)
      pending--
      if (pending <= 0) {
        var latest = wx.getStorageSync(OFFLINE_QUEUE_KEY) || []
        wx.setStorageSync(OFFLINE_QUEUE_KEY, compactQueue(remaining.concat(latest)))
        _flushing = false
      }
    }
    for (var i = 0; i < batch.length; i++) {
      (function (op) {
        if (op.type === 'save') {
          syncStudent(op.data, function (err) { finish(op, err) })
        } else if (op.type === 'saveSchedule') {
          syncSchedule(op.data, function (err) { finish(op, err) })
        } else {
          finish(op, true)
        }
      })(batch[i])
    }
  } catch (e) { _flushing = false }
}

function syncSchedule(schedule, cb) {
  if (!_db) { if (cb) cb(null); return }
  if (!getRealOpenid()) {
    markDirty(schedule)
    if (cb) cb('no_openid')
    return
  }
  ensureScheduleLocalKey(schedule)
  ensureScheduleUid(schedule)
  var coll = _db.collection('schedules')
  var docId = schedule._cloudId
  var studentCloudId = ''
  var hasActiveStudent = false
  try {
    var app = getApp()
    var students = (app && app.globalData && app.globalData.students) ? app.globalData.students : []
    for (var si = 0; si < students.length; si++) {
      if (!students[si] || students[si].deleted) continue
      var matchedStudent = schedule.studentUid ? students[si].studentUid === schedule.studentUid : (schedule.studentCloudId ? students[si]._cloudId === schedule.studentCloudId : students[si].id == schedule.studentId)
      if (matchedStudent && !schedule.studentUid && !schedule.studentCloudId && schedule.studentName && students[si].name && schedule.studentName !== students[si].name) matchedStudent = false
      if (matchedStudent) {
        hasActiveStudent = true
        ensureStudentUid(students[si])
        studentCloudId = students[si]._cloudId || ''
        if (!schedule.studentUid) schedule.studentUid = students[si].studentUid || ''
        break
      }
    }
  } catch (e) {}
  if (!schedule.deleted && schedule.status !== 'deleted' && schedule.status !== 'canceled' && !hasActiveStudent) {
    schedule._dirty = false
    if (cb) cb(null)
    return
  }
  var data = {
    openid: getRealOpenid(),
    scheduleUid: schedule.scheduleUid,
    id: schedule.id,
    localKey: schedule.localKey,
    studentId: schedule.studentId,
    studentUid: schedule.studentUid || '',
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
    beforeRemaining: schedule.beforeRemaining,
    beforeLastClassDate: schedule.beforeLastClassDate || '',
    createdAt: schedule.createdAt || '',
    updatedAt: schedule.updatedAt || Date.now()
  }
  var syncKey = scheduleIdentity(data) || ('schedule:' + (docId || Date.now()))
  if (_scheduleSyncing[syncKey]) {
    if (cb) _scheduleSyncing[syncKey].push(cb)
    return
  }
  _scheduleSyncing[syncKey] = cb ? [cb] : []
  var finishSchedule = function (err) {
    var callbacks = _scheduleSyncing[syncKey] || []
    delete _scheduleSyncing[syncKey]
    for (var ci = 0; ci < callbacks.length; ci++) {
      callbacks[ci](err || null)
    }
  }
  if (docId) {
    coll.doc(docId).update({ data: data })
      .then(function () { markSynced(schedule); finishSchedule(null) })
      .catch(function () {
        findScheduleDoc(coll, data)
          .then(function (res) {
            if (res.data && res.data.length) {
              schedule._cloudId = res.data[0]._id
              data = mergeScheduleData(res.data[0], data)
              applySyncedSchedule(schedule, data)
              return coll.doc(schedule._cloudId).update({ data: data })
            }
            return coll.add({ data: data }).then(function (addRes) {
              schedule._cloudId = addRes._id
            })
          })
          .then(function () {
            markSynced(schedule)
            try { getApp().save() } catch (e) {}
            finishSchedule(null)
          })
          .catch(function (e) { markDirty(schedule); finishSchedule(e) })
      })
  } else {
    findScheduleDoc(coll, data)
      .then(function (res) {
        if (res.data && res.data.length) {
          schedule._cloudId = res.data[0]._id
          data = mergeScheduleData(res.data[0], data)
          applySyncedSchedule(schedule, data)
          coll.doc(schedule._cloudId).update({ data: data })
            .then(function () {
              markSynced(schedule)
              try { getApp().save() } catch (e) {}
              finishSchedule(null)
            })
            .catch(function (e) { markDirty(schedule); finishSchedule(e) })
        } else {
          coll.add({ data: data })
            .then(function (addRes) {
              schedule._cloudId = addRes._id
              markSynced(schedule)
              try { getApp().save() } catch (e) {}
              finishSchedule(null)
            })
            .catch(function (e) { markDirty(schedule); finishSchedule(e) })
        }
      })
      .catch(function (e) { markDirty(schedule); finishSchedule(e) })
  }
}

function mergeScheduleData(existing, incoming) {
  if (!existing) return incoming
  if (!incoming) return existing
  ensureScheduleUid(existing)
  ensureScheduleUid(incoming)
  var best = newerSchedule(existing, incoming)
  var other = best === existing ? incoming : existing
  var merged = {}
  var keys = ['openid', 'scheduleUid', 'id', 'localKey', 'studentId', 'studentUid', 'studentCloudId', 'studentName', 'avatarSrc', 'date', 'startTime', 'plannedAmount', 'actualAmount', 'note', 'completeNote', 'type', 'status', 'deleted', 'deletedAt', 'earlyCompleted', 'originalDate', 'originalStartTime', 'completedAt', 'linkedHistoryTs', 'beforeRemaining', 'beforeLastClassDate', 'createdAt', 'updatedAt']
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]
    merged[k] = best[k] !== undefined && best[k] !== null && best[k] !== '' ? best[k] : other[k]
  }
  merged.updatedAt = Math.max(existing.updatedAt || 0, incoming.updatedAt || 0)
  return merged
}

function applySyncedSchedule(schedule, data) {
  if (!schedule || !data) return
  var keys = ['scheduleUid', 'id', 'localKey', 'studentId', 'studentUid', 'studentCloudId', 'studentName', 'avatarSrc', 'date', 'startTime', 'plannedAmount', 'actualAmount', 'note', 'completeNote', 'type', 'status', 'deleted', 'deletedAt', 'earlyCompleted', 'originalDate', 'originalStartTime', 'completedAt', 'linkedHistoryTs', 'beforeRemaining', 'beforeLastClassDate', 'createdAt', 'updatedAt']
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]
    if (data[k] !== undefined && data[k] !== null) schedule[k] = data[k]
  }
}

function findScheduleDoc(coll, data) {
  var byLocalKey = data.localKey ? { localKey: data.localKey } : null
  var realOpenid = data.openid || getRealOpenid()
  var tasks = []
  if (realOpenid && data.scheduleUid) tasks.push(coll.where({ openid: realOpenid, scheduleUid: data.scheduleUid }).get().catch(function () { return { data: [] } }))
  if (data.scheduleUid) tasks.push(coll.where({ _openid: '{openid}', scheduleUid: data.scheduleUid }).get().catch(function () { return { data: [] } }))
  if (byLocalKey && realOpenid) tasks.push(coll.where({ openid: realOpenid, localKey: data.localKey }).get().catch(function () { return { data: [] } }))
  if (byLocalKey) tasks.push(coll.where(byLocalKey).get().catch(function () { return { data: [] } }))
  if (realOpenid && data.id !== undefined && data.studentId !== undefined && data.createdAt) {
    tasks.push(coll.where({ openid: realOpenid, id: data.id, studentId: data.studentId, createdAt: data.createdAt }).get().catch(function () { return { data: [] } }))
  }
  if (!tasks.length) return Promise.resolve({ data: [] })
  return Promise.all(tasks).then(function (res) {
    var all = []
    for (var i = 0; i < res.length; i++) all = all.concat(res[i].data || [])
    var match = pickScheduleDoc(all, data)
    return { data: match ? [match] : [] }
  })
}

function pickScheduleDoc(list, data) {
  list = list || []
  if (!list.length) return null
  var exact = []
  var targetKey = scheduleIdentity(data)
  for (var i = 0; i < list.length; i++) {
    var item = list[i]
    if (!item) continue
    if (targetKey && scheduleIdentity(item) === targetKey) exact.push(item)
  }
  if (exact.length) return dedupeScheduleDocs(exact)[0]
  return dedupeScheduleDocs(list)[0]
}

function pullSchedules(cb, since) {
  if (!_db) { if (cb) cb(null); return }
  fetchOwnedSince('schedules', since || 0)
    .then(function (res) {
      res = dedupeScheduleDocs(res)
      var list = []
      for (var i = 0; i < res.length; i++) {
        var d = res[i]
        d._cloudId = d._id
        ensureScheduleUid(d)
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
function findStudentDoc(coll, data) {
  var tasks = []
  if (data.openid && data.studentUid) tasks.push(coll.where({ openid: data.openid, studentUid: data.studentUid }).get().catch(function () { return { data: [] } }))
  if (data.studentUid) tasks.push(coll.where({ _openid: '{openid}', studentUid: data.studentUid }).get().catch(function () { return { data: [] } }))
  if (data.openid && data.studentLocalId !== undefined && data.createdAt && data.name) {
    tasks.push(coll.where({ openid: data.openid, studentLocalId: data.studentLocalId, createdAt: data.createdAt, name: data.name }).get().catch(function () { return { data: [] } }))
    tasks.push(coll.where({ _openid: '{openid}', studentLocalId: data.studentLocalId, createdAt: data.createdAt, name: data.name }).get().catch(function () { return { data: [] } }))
  }
  if (!tasks.length) return Promise.resolve({ data: [] })
  return Promise.all(tasks).then(function (res) {
    var all = []
    for (var i = 0; i < res.length; i++) all = all.concat(res[i].data || [])
    var matched = pickStudentDoc(all, data)
    return { data: matched ? [matched] : [] }
  })
}

function pickStudentDoc(list, data) {
  list = list || []
  if (!list.length) return null
  var exact = []
  var targetKey = studentIdentity(data)
  for (var i = 0; i < list.length; i++) {
    var item = list[i]
    if (!item) continue
    if (targetKey && studentIdentity(item) === targetKey) exact.push(item)
  }
  if (exact.length) return dedupeStudentDocs(exact)[0]
  return dedupeStudentDocs(list)[0]
}

function syncStudent(student, cb) {
  if (!_db) { if (cb) cb(null); return }
  if (!getRealOpenid()) {
    markDirty(student)
    if (cb) cb('no_openid')
    return
  }
  var coll = _db.collection('students')
  ensureStudentUid(student)
  var docId = student._cloudId
  var data = {
    openid: getRealOpenid(),
    studentUid: student.studentUid,
    studentLocalId: student.id,
    name: student.name,
    avatarSrc: student.avatarSrc,
    totalLessons: student.totalLessons,
    remainingLessons: student.remainingLessons,
    expiryDate: student.expiryDate,
    note: student.note,
    lastClassDate: student.lastClassDate,
    lastModified: student.lastModified,
    history: normalizeHistory(student.history || []),
    deleted: student.deleted || false,
    deletedAt: student.deletedAt || '',
    createdAt: student.createdAt || U.today(),
    updatedAt: Math.max(student.updatedAt || 0, student.lastModified || 0, Date.now())
  }
  var syncKey = studentIdentity(data) || ('student:' + (docId || Date.now()))
  if (_studentSyncing[syncKey]) {
    if (cb) _studentSyncing[syncKey].push(cb)
    return
  }
  _studentSyncing[syncKey] = cb ? [cb] : []
  var finishStudent = function (err) {
    var callbacks = _studentSyncing[syncKey] || []
    delete _studentSyncing[syncKey]
    for (var ci = 0; ci < callbacks.length; ci++) {
      callbacks[ci](err || null)
    }
  }
  if (docId) {
    coll.doc(docId).update({ data: data })
      .then(function () {
        markSynced(student)
        finishStudent(null)
      })
      .catch(function () {
        findStudentDoc(coll, data)
          .then(function (res) {
            if (res.data && res.data.length) {
              student._cloudId = res.data[0]._id
              data = mergeStudentData(res.data[0], data)
              applySyncedStudent(student, data)
              return coll.doc(student._cloudId).update({ data: data })
            }
            return coll.add({ data: data }).then(function (addRes) {
              student._cloudId = addRes._id
            })
          })
          .then(function () {
            markSynced(student)
            try { getApp().save() } catch (e) {}
            finishStudent(null)
          })
          .catch(function (e) { markDirty(student); finishStudent(e) })
      })
  } else {
    findStudentDoc(coll, data)
      .then(function (res) {
        if (res.data && res.data.length) {
          student._cloudId = res.data[0]._id
          data = mergeStudentData(res.data[0], data)
          coll.doc(student._cloudId).update({ data: data })
            .then(function () {
              applySyncedStudent(student, data)
              markSynced(student)
              try { getApp().save() } catch (e) {}
              finishStudent(null)
            })
            .catch(function (e) { markDirty(student); finishStudent(e) })
        } else {
          coll.add({ data: data })
            .then(function (addRes) {
              student._cloudId = addRes._id
              markSynced(student)
              try { getApp().save() } catch (e) {}
              finishStudent(null)
            })
            .catch(function (e) { markDirty(student); finishStudent(e) })
        }
      })
      .catch(function (e) { markDirty(student); finishStudent(e) })
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
function pullFromCloud(cb, since) {
  if (!_db) { if (cb) cb(null); return }
  fetchOwnedSince('students', since || 0)
    .then(function (res) {
      res = dedupeStudentDocs(res)
      var list = []
      for (var i = 0; i < res.length; i++) {
        var d = res[i]
        d._cloudId = d._id
        ensureStudentUid(d)
        d.history = normalizeHistory(d.history || [])
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
function uniqueUserRecords(a, b) {
  var map = {}, list = []
  var add = function (arr) {
    arr = arr || []
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i]
      if (!item || !item._id || map[item._id]) continue
      map[item._id] = true
      list.push(item)
    }
  }
  add(a); add(b)
  return list
}

function getUserRecords(realOpenid) {
  var coll = _db.collection('users')
  var legacyChecked = false
  var legacyKey = '_users_legacy_checked_' + hashText(realOpenid)
  try { legacyChecked = !!wx.getStorageSync(legacyKey) } catch (e) {}
  return coll.where({ openid: realOpenid }).get()
    .then(function (res) {
      var byOpenid = res.data || []
      if (byOpenid.length && legacyChecked) return byOpenid
      return coll.where({ _openid: '{openid}' }).get()
        .then(function (ownRes) {
          try { wx.setStorageSync(legacyKey, true) } catch (e) {}
          return uniqueUserRecords(byOpenid, ownRes.data || [])
        })
        .catch(function () {
          if (byOpenid.length) {
            try { wx.setStorageSync(legacyKey, true) } catch (e) {}
          }
          return byOpenid
        })
    })
}

function mergeMemberState(records, incoming, realOpenid) {
  var today = U.today()
  var list = (records || []).slice()
  if (incoming) list.push(incoming)
  var merged = {
    openid: realOpenid,
    isProMember: false,
    memberExpired: false,
    proExpiry: '',
    upgradeShown: false,
    welcomeReward: 0,
    pendingReward: 0,
    easterClaimed: false,
    easterProExpiry: ''
  }
  var hasLifetime = false
  var maxExpiry = ''
  var hasExpired = false
  for (var i = 0; i < list.length; i++) {
    var d = list[i] || {}
    var exp = d.proExpiry || d.easterProExpiry || ''
    if (d.upgradeShown) merged.upgradeShown = true
    if ((d.welcomeReward || 0) > merged.welcomeReward) merged.welcomeReward = d.welcomeReward || 0
    if ((d.pendingReward || 0) > merged.pendingReward) merged.pendingReward = d.pendingReward || 0
    if (d.easterClaimed) merged.easterClaimed = true
    if (d.easterProExpiry && (!merged.easterProExpiry || d.easterProExpiry > merged.easterProExpiry)) merged.easterProExpiry = d.easterProExpiry
    if (d.isProMember && !d.memberExpired && !exp) {
      hasLifetime = true
    } else if (d.isProMember && !d.memberExpired && exp && exp > today) {
      if (!maxExpiry || exp > maxExpiry) maxExpiry = exp
    } else if (d.memberExpired || (exp && exp <= today)) {
      hasExpired = true
    }
  }
  if (hasLifetime) {
    merged.isProMember = true
    merged.memberExpired = false
    merged.proExpiry = ''
  } else if (maxExpiry) {
    merged.isProMember = true
    merged.memberExpired = false
    merged.proExpiry = maxExpiry
  } else if (hasExpired) {
    merged.isProMember = false
    merged.memberExpired = true
    merged.proExpiry = ''
  }
  return merged
}

function updateUserRecords(records, data, cb) {
  var coll = _db.collection('users')
  if (!records || !records.length) {
    coll.add({ data: data })
      .then(function () { if (cb) cb(null) })
      .catch(function (e) { if (cb) cb(e) })
    return
  }
  var pending = records.length
  var done = function () {
    pending--
    if (pending <= 0 && cb) cb(null)
  }
  for (var i = 0; i < records.length; i++) {
    coll.doc(records[i]._id).update({ data: data })
      .then(done)
      .catch(done)
  }
}

function syncMember(isPro, memberExpired, proExpiry, upgradeShown, cb) {
  if (!_db) { if (cb) cb(null); return }
  var app = getApp()
  var realOpenid = (app && app.globalData && app.globalData._realOpenid) ? app.globalData._realOpenid : ''
  if (!realOpenid) { if (cb) cb('no_openid'); return }
  getUserRecords(realOpenid)
    .then(function (res) {
      var incoming = { openid: realOpenid, isProMember: isPro, memberExpired: memberExpired, proExpiry: proExpiry || '', upgradeShown: !!upgradeShown }
      var merged = mergeMemberState(res, incoming, realOpenid)
      var data = { openid: realOpenid, isProMember: merged.isProMember, memberExpired: merged.memberExpired, proExpiry: merged.proExpiry || '', upgradeShown: merged.upgradeShown }
      updateUserRecords(res, data, cb)
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
  if (!_db) { if (cb) cb(null, null, null, null, null, null, null); return }
  var app = getApp()
  var realOpenid = (app && app.globalData && app.globalData._realOpenid) ? app.globalData._realOpenid : ''
  if (!realOpenid) { if (cb) cb(null, null, null, null, null, null, null); return }
  getUserRecords(realOpenid)
    .then(function (res) {
      if (res.length) {
        var d = mergeMemberState(res, null, realOpenid)
        if (cb) cb(d.isProMember, d.memberExpired, d.proExpiry || '', d.welcomeReward || 0, d.pendingReward || 0, d.upgradeShown || false, !!d.easterClaimed)
      } else {
        if (cb) cb(false, false, '', 0, 0, false, false)
      }
    })
    .catch(function () { if (cb) cb(null, null, null, null, null, null, null) })
}

function clearRewardFlags(cb) {
  if (!_db) { if (cb) cb(); return }
  var app = getApp()
  var realOpenid = (app && app.globalData && app.globalData._realOpenid) ? app.globalData._realOpenid : ''
  if (!realOpenid) { if (cb) cb(); return }
  getUserRecords(realOpenid)
    .then(function (res) {
      if (res.length) {
        updateUserRecords(res, { welcomeReward: 0, pendingReward: 0 }, function () { if (cb) cb() })
      } else { if (cb) cb() }
    })
    .catch(function () { if (cb) cb() })
}

// ===== 彩蛋标记 =====
function syncEasterClaimed() {
  if (!_db) return
  var app = getApp()
  var realOpenid = (app && app.globalData && app.globalData._realOpenid) ? app.globalData._realOpenid : ''
  var data = { easterClaimed: true, easterProExpiry: '' }
  if (realOpenid) data.openid = realOpenid
  if (!realOpenid) return
  getUserRecords(realOpenid)
    .then(function (res) {
      updateUserRecords(res, data)
    })
    .catch(function () {})
}

function pullEasterClaimed(cb) {
  if (!_db) { if (cb) cb(false); return }
  var app = getApp()
  var realOpenid = (app && app.globalData && app.globalData._realOpenid) ? app.globalData._realOpenid : ''
  if (!realOpenid) { if (cb) cb(false); return }
  getUserRecords(realOpenid)
    .then(function (res) {
      var d = mergeMemberState(res, null, realOpenid)
      if (cb) cb(!!d.easterClaimed)
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

function trackEvents(entries) {
  if (!_db || !entries || !entries.length) return
  _db.collection('analytics').add({
    data: {
      type: 'batch',
      count: entries.length,
      events: entries,
      ts: Date.now()
    }
  }).catch(function () {})
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
      if (cb) cb((payResult && (payResult.errMsg || payResult.message)) || 'pay_error', payResult)
      return
    }
    var p = payResult.payment
    if (!p.timeStamp || !p.nonceStr || !p.package || !p.paySign) {
      if (cb) cb('invalid payment params', payResult)
      return
    }
    wx.requestPayment({
      timeStamp: p.timeStamp,
      nonceStr: p.nonceStr,
      package: p.package,
      signType: p.signType || 'RSA',
      paySign: p.paySign,
      success: function () { if (cb) cb(null, payResult) },
      fail: function (e) {
        if (cb) cb((e && e.errMsg) || 'pay_cancel', e)
      }
    })
  }).catch(function (e) {
    if (cb) cb((e && (e.errMsg || e.message)) || 'pay_error', e)
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
  watchOwned: watchOwned,
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
  trackEvents: trackEvents,
  processReferral: processReferral,
  submitFeedback: submitFeedback
}
