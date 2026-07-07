var util = require('./utils/util.js')
var cloud = require('./utils/cloud.js')
var analytics = require('./utils/analytics.js')
var schedule = require('./utils/schedule.js')
var BACKFILL_BATCH_SIZE = 20
var CLOUD_PULL_MIN_INTERVAL = 60000
var CLOUD_BACKFILL_DEBOUNCE = 3000
var CLOUD_BACKFILL_MIN_INTERVAL = 30000
var REAL_OPENID_KEY = '_real_openid'
var _studentsBackfilling = false
var _schedulesBackfilling = false

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

function legacyStudentKey(student) {
  if (!student) return ''
  var localId = student.studentLocalId !== undefined && student.studentLocalId !== null ? student.studentLocalId : student.id
  if (localId === undefined || localId === null || localId === '' || !student.createdAt || !student.name) return ''
  return localId + '|' + student.createdAt + '|' + hashText(student.name)
}

function isCloudDerivedStudentUid(uid) {
  return !!(uid && String(uid).indexOf('stu_cloud_') === 0)
}

function isCloudDerivedScheduleUid(uid) {
  return !!(uid && String(uid).indexOf('sch_cloud_') === 0)
}

App({
  globalData: {
    openid: '',
    students: [],
    nextId: 0,
    schedules: [],
    nextScheduleId: 0,
    memberExpired: false,
    isProMember: false,
    proExpiry: '',
    welcomeReward: 0,
    pendingReward: 0,
    upgradeShown: false,
    swipeHintDismissed: false,
    _pendingWelcome: null,
    bannerDismissedToday: {},
    statusBarHeight: 20,
    _lastMemberSyncKey: '',
    lastStudentSyncAt: 0,
    lastScheduleSyncAt: 0,
    lastFullSyncDate: ''
  },

  onLaunch: function () {
    var that = this
    var sys = wx.getSystemInfoSync()
    this.globalData.statusBarHeight = sys.statusBarHeight

    // 闅愮鎺堟潈锛堢敤鎴烽娆℃墦寮€鏃跺脊绐楀悓鎰忛殣绉佹斂绛栵級
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({
        success: function () {},
        fail: function () {}
      })
    }

    // 鏈湴鎸佷箙鍖栬韩浠?
    this.globalData.openid = this.getLocalId()
    this.loadData()
    analytics.track('launch')

    // 闈欓粯鐧诲綍锛氳幏鍙栧井淇ode澶囩敤
    wx.login({
      success: function (res) {
        if (res.code) { that.globalData._wxCode = res.code }
      }
    })

    var opts = wx.getLaunchOptionsSync()
    var refId = (opts.query && opts.query.ref) ? opts.query.ref : ''

    setTimeout(function () {
      that.initCloudSync(refId)
    }, 0)
  },

  initCloudSync: function (refId) {
    var that = this
    try {
      cloud.init()
    } catch (e) {
      return
    }
    if (!cloud.isReady() || !wx.cloud || !wx.cloud.callFunction) return

    var afterOpenid = function (openid) {
      if (!openid) return
      that.globalData._realOpenid = openid
      try { wx.setStorageSync(REAL_OPENID_KEY, openid) } catch (e) {}
      if (refId) that.globalData._pendingRef = refId
      if (refId) {
        setTimeout(function () {
          var pages = getCurrentPages()
          var page = pages.length ? pages[pages.length - 1] : null
          if (page && page.processPendingReferral) page.processPendingReferral()
        }, 0)
      }

      if (wx.getStorageSync('_pending_easter_sync')) {
        that.globalData._skipMemberPullOnce = true
        cloud.syncEasterClaimed()
        wx.removeStorageSync('_pending_easter_sync')
      }
      that.pullCloudData(function () {
        that.scheduleCloudBackfill(true)
      })
      cloud.pullEasterClaimed(function (claimed) {
        if (claimed) wx.setStorageSync('_easter_egg_claimed', true)
      })
    }

    var cachedOpenid = ''
    try { cachedOpenid = wx.getStorageSync(REAL_OPENID_KEY) || '' } catch (e) {}
    if (cachedOpenid) {
      afterOpenid(cachedOpenid)
      return
    }

    setTimeout(function () {
      try {
        wx.cloud.callFunction({
          name: 'getOpenid',
          success: function (res) {
            if (!res.result || !res.result.openid) return
            afterOpenid(res.result.openid)
          },
          fail: function () {}
        })
      } catch (e) {}
    }, 300)
  },

  // 鏈湴璁惧鏍囪瘑
  getLocalId: function () {
    var id = wx.getStorageSync('_local_id')
    if (!id) {
      id = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      wx.setStorageSync('_local_id', id)
    }
    return id
  },

  loadData: function () {
    var key = 'app_data_' + this.globalData.openid
    var data = wx.getStorageSync(key) || {}
    var today = util.today()

    // 杩佺Щ鏃ф暟鎹?
    if (!data.students || !data.students.length) {
      var oldData = wx.getStorageSync('app_data')
      if (oldData && oldData.students && oldData.students.length) {
        data = oldData
        wx.removeStorageSync('app_data')
      }
    }

    this.globalData.students = normalizeStudents(data.students || [])
    this.globalData.nextId = data.nextId || 0
    this.globalData.schedules = schedule.cleanOld(normalizeSchedules(data.schedules || []), today)
    var idFix = normalizeStudentIds(this.globalData.students, this.globalData.schedules, this.globalData.nextId)
    this.globalData.nextId = idFix.nextId
    this.globalData.nextScheduleId = data.nextScheduleId || 0
    for (var si = 0; si < this.globalData.schedules.length; si++) {
      var sid = parseInt(this.globalData.schedules[si].id)
      if (!isNaN(sid) && sid >= this.globalData.nextScheduleId) this.globalData.nextScheduleId = sid + 1
    }
    this.globalData.memberExpired = data.memberExpired || false
    this.globalData.isProMember = data.isProMember || false
    this.globalData.proExpiry = data.proExpiry || data.easterProExpiry || ''
    this.globalData.upgradeShown = data.upgradeShown || false
    this.globalData._lastMemberSyncKey = [this.globalData.isProMember ? 1 : 0, this.globalData.memberExpired ? 1 : 0, this.globalData.proExpiry || '', this.globalData.upgradeShown ? 1 : 0].join('|')
    this.globalData.swipeHintDismissed = data.swipeHintDismissed || false
    this.globalData.lastStudentSyncAt = data.lastStudentSyncAt || 0
    this.globalData.lastScheduleSyncAt = data.lastScheduleSyncAt || 0
    this.globalData.lastFullSyncDate = data.lastFullSyncDate || ''
    // Pro杩囨湡妫€娴?
    if (this.globalData.proExpiry && today > this.globalData.proExpiry) {
      this.globalData.isProMember = false
      this.globalData.memberExpired = true
      this.globalData.proExpiry = ''
    }
    this.globalData._lastMemberSyncKey = [this.globalData.isProMember ? 1 : 0, this.globalData.memberExpired ? 1 : 0, this.globalData.proExpiry || '', this.globalData.upgradeShown ? 1 : 0].join('|')
    this.globalData.bannerDismissedToday = data.bannerDismissedToday || {}
    if (this.globalData.bannerDismissedToday.date !== today) {
      this.globalData.bannerDismissedToday = { date: today, sleepy: false, expiry: false, memberExpired: false }
    }
    if (idFix.changed) this.save()
  },

  // 浜戠鏁版嵁鎷夊彇 + 鍚堝苟锛堜簯绔紭鍏堬級
  pullCloudData: function (cb) {
    var that = this
    if (!that.globalData._realOpenid) {
      if (typeof cb === 'function') cb()
      return
    }
    var today = util.today()
    var needFull = !that.globalData.lastStudentSyncAt || !that.globalData.lastScheduleSyncAt
    var studentSince = needFull ? 0 : (that.globalData.lastStudentSyncAt || 0)
    var scheduleSince = needFull ? 0 : (that.globalData.lastScheduleSyncAt || 0)
    var pendingPulls = 2
    var finishPull = function () {
      pendingPulls--
      if (pendingPulls <= 0) {
        that.globalData._lastCloudPullAt = Date.now()
        that.refreshCurrentPage()
        if (typeof cb === 'function') cb()
      }
    }
    // 鎷夊彇浼氬憳鐘舵€?
    cloud.pullMember(function (isPro, expired, proExp, welcomeDays, pendingDays, upgradeShown) {
      if (isPro !== null) {
        if (that.globalData._skipMemberPullOnce) {
          that.globalData._skipMemberPullOnce = false
          that.refreshCurrentPage()
          return
        }
        that.globalData.isProMember = !!isPro
        that.globalData.memberExpired = !!expired
        that.globalData.proExpiry = proExp || ''
        that.globalData.welcomeReward = welcomeDays || 0
        that.globalData.pendingReward = pendingDays || 0
        that.globalData.upgradeShown = !!upgradeShown
        that.globalData._lastMemberSyncKey = [that.globalData.isProMember ? 1 : 0, that.globalData.memberExpired ? 1 : 0, that.globalData.proExpiry || '', that.globalData.upgradeShown ? 1 : 0].join('|')
        that.refreshCurrentPage()
      }
    })
    // 鎷夊彇瀛﹀憳鏁版嵁锛堟湰鍦版湁娲昏穬瀛﹀憳鏃惰烦杩囷紝閬垮厤浜戠鍚堝苟瀵艰嚧閲嶅/涓㈠け锛?
    cloud.pullFromCloud(function (cloudList) {
      applyCloudStudents(that, cloudList || [])
      that.globalData.lastStudentSyncAt = nextSyncCursor(that.globalData.lastStudentSyncAt, cloudList || [])
      if (needFull) that.globalData.lastFullSyncDate = today
      that.save()
      finishPull()
      return
    }, studentSince)
    cloud.pullSchedules(function (cloudSchedules) {
      try {
        applyCloudSchedules(that, cloudSchedules || [])
        that.globalData.lastScheduleSyncAt = nextSyncCursor(that.globalData.lastScheduleSyncAt, cloudSchedules || [])
        if (needFull) that.globalData.lastFullSyncDate = today
        that.save()
        that.scheduleCloudBackfill(false)
        return
      } finally {
        finishPull()
      }
    }, scheduleSince)
  },

  syncCloudQuietly: function (force, cb) {
    if (!cloud.isReady() || !cloud.isOnline()) {
      if (typeof cb === 'function') cb()
      return
    }
    if (!this.globalData._realOpenid) {
      if (typeof cb === 'function') cb()
      return
    }
    var now = Date.now()
    if (!force && this.globalData._cloudPulling) {
      if (typeof cb === 'function') cb()
      return
    }
    if (!force && this.globalData._lastCloudPullAt && now - this.globalData._lastCloudPullAt < CLOUD_PULL_MIN_INTERVAL) {
      if (typeof cb === 'function') cb()
      return
    }
    var that = this
    this.globalData._cloudPulling = true
    this.pullCloudData(function () {
      that.globalData._cloudPulling = false
      that.refreshCurrentPage()
      if (typeof cb === 'function') cb()
    })
  },

  startRealtimeSync: function () {
    var that = this
    if (!cloud.isReady() || !cloud.isOnline()) return
    if (!this.globalData._realOpenid) {
      if (this.globalData._watchWaitTimer) clearTimeout(this.globalData._watchWaitTimer)
      this.globalData._watchWaitTimer = setTimeout(function () { that.startRealtimeSync() }, 800)
      return
    }
    var since = Math.max(0, Date.now() - 5000)
    if (!this.globalData._studentWatcher) {
      this.globalData._studentWatcher = cloud.watchOwned('students', since, function (docs) {
        if (applyCloudStudents(that, docs || [])) {
          that.globalData.lastStudentSyncAt = nextSyncCursor(that.globalData.lastStudentSyncAt, docs || [])
          that.save()
          that.refreshCurrentPage()
        }
      }, function () {
        that.stopRealtimeSync()
      })
    }
    if (!this.globalData._scheduleWatcher) {
      this.globalData._scheduleWatcher = cloud.watchOwned('schedules', since, function (docs) {
        if (applyCloudSchedules(that, docs || [])) {
          that.globalData.lastScheduleSyncAt = nextSyncCursor(that.globalData.lastScheduleSyncAt, docs || [])
          that.save()
          that.refreshCurrentPage()
        }
      }, function () {
        that.stopRealtimeSync()
      })
    }
  },

  stopRealtimeSync: function () {
    if (this.globalData._watchWaitTimer) {
      clearTimeout(this.globalData._watchWaitTimer)
      this.globalData._watchWaitTimer = null
    }
    if (this.globalData._studentWatcher && this.globalData._studentWatcher.close) {
      try { this.globalData._studentWatcher.close() } catch (e) {}
    }
    if (this.globalData._scheduleWatcher && this.globalData._scheduleWatcher.close) {
      try { this.globalData._scheduleWatcher.close() } catch (e) {}
    }
    this.globalData._studentWatcher = null
    this.globalData._scheduleWatcher = null
  },

  hasDirtyCloudData: function () {
    var students = this.globalData.students || []
    for (var i = 0; i < students.length; i++) {
      if (students[i] && (!students[i]._cloudId || students[i]._dirty)) return true
    }
    var schedules = this.globalData.schedules || []
    for (var j = 0; j < schedules.length; j++) {
      if (schedules[j] && (!schedules[j]._cloudId || schedules[j]._dirty)) return true
    }
    return cloud.getQueueLength && cloud.getQueueLength() > 0
  },

  scheduleCloudBackfill: function (force) {
    if (!cloud.isReady() || !cloud.isOnline() || !this.globalData._realOpenid) return
    var now = Date.now()
    if (!force && this.globalData._lastBackfillAt && now - this.globalData._lastBackfillAt < CLOUD_BACKFILL_MIN_INTERVAL) return
    if (!force && !this.hasDirtyCloudData()) return
    var that = this
    if (this.globalData._backfillTimer) clearTimeout(this.globalData._backfillTimer)
    this.globalData._backfillTimer = setTimeout(function () {
      that.globalData._backfillTimer = null
      if (!cloud.isReady() || !cloud.isOnline() || !that.globalData._realOpenid) return
      if (!force && !that.hasDirtyCloudData()) return
      that.globalData._lastBackfillAt = Date.now()
      cloud.flushQueue()
      syncLocalStudentsToCloud(that.globalData.students || [])
      syncLocalSchedulesToCloud(that.globalData.schedules || [])
    }, force ? 0 : CLOUD_BACKFILL_DEBOUNCE)
  },

  save: function () {
    var key = 'app_data_' + this.globalData.openid
    this.globalData.students = normalizeStudents(this.globalData.students || [])
    this.globalData.schedules = schedule.cleanOld(normalizeSchedules(this.globalData.schedules || []), util.today())
    wx.setStorageSync(key, {
      students: this.globalData.students,
      nextId: this.globalData.nextId,
      schedules: this.globalData.schedules,
      nextScheduleId: this.globalData.nextScheduleId || 0,
      memberExpired: this.globalData.memberExpired,
      isProMember: this.globalData.isProMember,
      proExpiry: this.globalData.proExpiry,
      upgradeShown: this.globalData.upgradeShown,
      swipeHintDismissed: this.globalData.swipeHintDismissed,
      bannerDismissedToday: this.globalData.bannerDismissedToday,
      lastStudentSyncAt: this.globalData.lastStudentSyncAt || 0,
      lastScheduleSyncAt: this.globalData.lastScheduleSyncAt || 0,
      lastFullSyncDate: this.globalData.lastFullSyncDate || ''
    })
    // 浜戠鍚屾锛堥潤榛橈紝澶辫触涓嶉樆濉烇級
    if (cloud.isReady() && this.globalData._realOpenid) {
      var memberKey = [this.globalData.isProMember ? 1 : 0, this.globalData.memberExpired ? 1 : 0, this.globalData.proExpiry || '', this.globalData.upgradeShown ? 1 : 0].join('|')
      var that = this
      if (memberKey !== this.globalData._lastMemberSyncKey) {
        cloud.syncMember(this.globalData.isProMember, this.globalData.memberExpired, this.globalData.proExpiry, this.globalData.upgradeShown, function (err) {
          if (!err) that.globalData._lastMemberSyncKey = memberKey
        })
      }
      this.scheduleCloudBackfill(false)
    }
  },

  refreshCurrentPage: function () {
    setTimeout(function () {
      var pages = getCurrentPages()
      if (pages.length > 0 && pages[pages.length - 1].reload) {
        pages[pages.length - 1].reload()
      }
    }, 0)
  }
})

// 浜戠鏁版嵁鍚堝苟鍒版湰鍦拌褰曪紙淇濈暀鏈湴瀛楁缁撴瀯锛?
function syncLocalStudentsToCloud(students) {
  if (!cloud.isReady() || !cloud.isOnline() || _studentsBackfilling) return
  var sent = 0, pending = 0
  _studentsBackfilling = true
  var done = function () {
    pending--
    if (pending <= 0) _studentsBackfilling = false
  }
  for (var i = 0; i < (students || []).length; i++) {
    if (sent >= BACKFILL_BATCH_SIZE) break
    var item = students[i]
    if (!item || (item._cloudId && !item._dirty)) continue
    sent++
    pending++
    ;(function (studentItem) {
      cloud.syncStudent(studentItem, function (err) {
        if (err) cloud.queueOp('save', studentItem)
        done()
      })
    })(item)
  }
  if (!sent) _studentsBackfilling = false
}

function syncLocalSchedulesToCloud(schedules) {
  if (!cloud.isReady() || !cloud.isOnline() || _schedulesBackfilling) return
  var sent = 0, pending = 0
  var activeStudents = {}
  var students = getApp().globalData.students || []
  for (var si = 0; si < students.length; si++) {
    if (students[si] && !students[si].deleted) {
      activeStudents[students[si].id] = students[si]
      if (students[si].studentUid) activeStudents['uid:' + students[si].studentUid] = students[si]
      if (students[si]._cloudId) activeStudents['cloud:' + students[si]._cloudId] = students[si]
    }
  }
  _schedulesBackfilling = true
  var done = function () {
    pending--
    if (pending <= 0) _schedulesBackfilling = false
  }
  for (var i = 0; i < (schedules || []).length; i++) {
    if (sent >= BACKFILL_BATCH_SIZE) break
    var item = schedules[i]
    if (!item || (item._cloudId && !item._dirty)) continue
    var hasActiveStudent = item.studentUid ? activeStudents['uid:' + item.studentUid] : (item.studentCloudId ? activeStudents['cloud:' + item.studentCloudId] : activeStudents[item.studentId])
    if (hasActiveStudent && !item.studentUid && !item.studentCloudId && item.studentName && hasActiveStudent.name && item.studentName !== hasActiveStudent.name) hasActiveStudent = null
    if (!item.deleted && item.status !== schedule.STATUS.DELETED && !hasActiveStudent) continue
    sent++
    pending++
    cloud.ensureScheduleLocalKey(item)
    ;(function (scheduleItem) {
      cloud.syncSchedule(scheduleItem, function (err) {
        if (err) cloud.queueOp('saveSchedule', scheduleItem)
        done()
      })
    })(item)
  }
  if (!sent) _schedulesBackfilling = false
}

function markCloudIdentityDirty(app) {
  if (!app || !app.globalData || app.globalData._cloudIdentityBackfilled) return
  app.globalData._cloudIdentityBackfilled = true
  var students = app.globalData.students || []
  for (var i = 0; i < students.length; i++) {
    if (students[i]) students[i]._dirty = true
  }
  var schedules = app.globalData.schedules || []
  for (var j = 0; j < schedules.length; j++) {
    if (schedules[j]) schedules[j]._dirty = true
  }
}

function nextSyncCursor(current, docs) {
  var max = current || 0
  docs = docs || []
  for (var i = 0; i < docs.length; i++) {
    var d = docs[i] || {}
    var ts = parseInt(d.updatedAt || d.lastModified || d.completedAt || d.createdAt || 0)
    if (!isNaN(ts) && ts > max) max = ts
  }
  return Math.max(max, Date.now() - 5000)
}

function applyCloudStudents(app, cloudList) {
  if (!app || !app.globalData) return false
  cloudList = cloudList || []
  if (!cloudList.length) {
    repairScheduleStudentLinks(app.globalData.schedules || [], app.globalData.students || [])
    return false
  }
  var local = app.globalData.students || []
  var merged = {}
  for (var i = 0; i < local.length; i++) {
    if (local[i]) merged[local[i].id] = local[i]
  }
  var changed = false
  for (var j = 0; j < cloudList.length; j++) {
    var cs = cloudList[j]
    if (!cs) continue
    if (!cs._cloudId && cs._id) cs._cloudId = cs._id
    if (!cs.studentUid) {
      ensureStudentUid(cs)
      cs._dirty = true
    }
    var found = false
    for (var k = 0; k < local.length; k++) {
      if (sameStudentRecord(local[k], cs)) {
        var beforeTs = local[k].updatedAt || local[k].lastModified || 0
        var beforeCloudId = local[k]._cloudId || ''
        local[k] = mergeCloudToLocal(local[k], cs)
        local[k]._dirty = false
        merged[local[k].id] = local[k]
        found = true
        if ((local[k].updatedAt || local[k].lastModified || 0) > beforeTs || (!beforeCloudId && local[k]._cloudId)) changed = true
        break
      }
    }
    if (!found) {
      var newId = pickCloudStudentId(cs, merged, app.globalData.nextId)
      if (newId >= app.globalData.nextId) app.globalData.nextId = newId + 1
      cs.id = newId
      cs._dirty = !!cs._dirty
      merged[newId] = cs
      changed = true
    }
  }
  var list = []
  for (var key in merged) { if (merged.hasOwnProperty(key)) list.push(merged[key]) }
  app.globalData.students = normalizeStudents(list)
  if (repairScheduleStudentLinks(app.globalData.schedules || [], app.globalData.students || [])) changed = true
  return changed
}

function applyCloudSchedules(app, cloudSchedules) {
  if (!app || !app.globalData) return false
  cloudSchedules = cloudSchedules || []
  var localSchedules = app.globalData.schedules || []
  var changed = false
  if (cloudSchedules.length) {
    for (var ci = 0; ci < cloudSchedules.length; ci++) {
      if (cloudSchedules[ci] && !cloudSchedules[ci]._cloudId && cloudSchedules[ci]._id) cloudSchedules[ci]._cloudId = cloudSchedules[ci]._id
      if (cloudSchedules[ci] && !cloudSchedules[ci].scheduleUid) {
        ensureScheduleUid(cloudSchedules[ci])
        cloudSchedules[ci]._dirty = true
      }
    }
    if (!localSchedules.length) {
      app.globalData.schedules = schedule.cleanOld(normalizeSchedules(cloudSchedules), util.today())
      changed = true
    } else {
      if (mergeScheduleCloudIds(localSchedules, cloudSchedules)) changed = true
      if (mergeMissingCloudSchedules(localSchedules, cloudSchedules)) changed = true
      if (changed) app.globalData.schedules = schedule.cleanOld(normalizeSchedules(localSchedules), util.today())
    }
  }
  if (repairScheduleStudentLinks(app.globalData.schedules || [], app.globalData.students || [])) changed = true
  updateNextScheduleId(app)
  return changed
}

function sameStudentRecord(local, cloudStudent) {
  if (!local || !cloudStudent) return false
  if (cloudStudent._cloudId && local._cloudId === cloudStudent._cloudId) return true
  if (cloudStudent._id && local._cloudId === cloudStudent._id) return true
  if (local.studentUid && cloudStudent.studentUid && local.studentUid === cloudStudent.studentUid) return true
  var localLegacy = legacyStudentKey(local)
  var cloudLegacy = legacyStudentKey(cloudStudent)
  if (localLegacy && cloudLegacy && localLegacy === cloudLegacy && (!local.studentUid || !cloudStudent.studentUid || isCloudDerivedStudentUid(local.studentUid) || isCloudDerivedStudentUid(cloudStudent.studentUid))) return true
  return false
}

function mergeScheduleCloudIds(localSchedules, cloudSchedules) {
  var changed = false
  for (var i = 0; i < (cloudSchedules || []).length; i++) {
    var cs = cloudSchedules[i]
    for (var j = 0; j < (localSchedules || []).length; j++) {
      var local = localSchedules[j]
      if (!local) continue
      if (sameScheduleRecord(local, cs)) {
        if (mergeCloudScheduleToLocal(local, cs)) changed = true
        break
      }
    }
  }
  return changed
}

function sameScheduleRecord(local, cloudSchedule) {
  if (!local || !cloudSchedule) return false
  if (cloudSchedule._cloudId && local._cloudId === cloudSchedule._cloudId) return true
  if (local.localKey && cloudSchedule.localKey && local.localKey === cloudSchedule.localKey) return true
  var localKey = scheduleIdentity(local)
  var cloudKey = scheduleIdentity(cloudSchedule)
  if (localKey && cloudKey && localKey === cloudKey) return true
  return false
}

function mergeCloudScheduleToLocal(local, cs) {
  if (!local || !cs) return
  var before = JSON.stringify({
    cloudId: local._cloudId || '',
    updatedAt: local.updatedAt || 0,
    status: local.status || '',
    date: local.date || '',
    startTime: local.startTime || '',
    plannedAmount: local.plannedAmount,
    actualAmount: local.actualAmount,
    deleted: !!local.deleted
  })
  var shouldOverwrite = scheduleTimeScore(cs) >= scheduleTimeScore(local)
  if (shouldOverwrite) {
    var keys = ['scheduleUid', 'id', 'studentId', 'studentUid', 'studentCloudId', 'studentName', 'avatarSrc', 'date', 'startTime', 'plannedAmount', 'actualAmount', 'note', 'completeNote', 'type', 'status', 'deleted', 'deletedAt', 'earlyCompleted', 'originalDate', 'originalStartTime', 'completedAt', 'linkedHistoryTs', 'beforeRemaining', 'beforeLastClassDate', 'createdAt', 'updatedAt']
    for (var i = 0; i < keys.length; i++) {
      if (hasCloudField(cs, keys[i])) local[keys[i]] = cs[keys[i]]
    }
  }
  local._cloudId = cs._cloudId || cs._id || local._cloudId
  if (!local.localKey && cs.localKey) local.localKey = cs.localKey
  local._dirty = false
  var after = JSON.stringify({
    cloudId: local._cloudId || '',
    updatedAt: local.updatedAt || 0,
    status: local.status || '',
    date: local.date || '',
    startTime: local.startTime || '',
    plannedAmount: local.plannedAmount,
    actualAmount: local.actualAmount,
    deleted: !!local.deleted
  })
  return before !== after
}

function mergeMissingCloudSchedules(localSchedules, cloudSchedules) {
  var changed = false
  for (var i = 0; i < (cloudSchedules || []).length; i++) {
    var cs = cloudSchedules[i]
    if (!cs || cs.deleted) continue
    if (hasLocalSchedule(localSchedules, cs)) continue
    localSchedules.push(cs)
    changed = true
  }
  return changed
}

function hasLocalSchedule(localSchedules, cloudSchedule) {
  var targetKey = scheduleIdentity(cloudSchedule)
  for (var i = 0; i < (localSchedules || []).length; i++) {
    var local = localSchedules[i]
    if (!local) continue
    if (cloudSchedule._cloudId && local._cloudId === cloudSchedule._cloudId) return true
    if (cloudSchedule.scheduleUid && local.scheduleUid === cloudSchedule.scheduleUid) return true
    if (cloudSchedule.localKey && local.localKey === cloudSchedule.localKey) return true
    if (targetKey && scheduleIdentity(local) === targetKey) return true
  }
  return false
}

function normalizeSchedules(schedules) {
  var map = {}, order = [], result = []
  schedules = schedules || []
  for (var i = 0; i < schedules.length; i++) {
    var item = schedules[i]
    if (!item) continue
    ensureScheduleUid(item)
    var key = scheduleIdentity(item) || ('idx:' + i)
    if (!map[key]) order.push(key)
    map[key] = mergeScheduleRecord(map[key], item)
  }
  for (var j = 0; j < order.length; j++) result.push(map[order[j]])
  return normalizeSchedulesBySlot(result)
}

function scheduleIdentity(s) {
  if (!s) return ''
  if (s.scheduleUid && !isCloudDerivedScheduleUid(s.scheduleUid)) return 'scheduleUid:' + s.scheduleUid
  if (s.localKey) return 'localKey:' + s.localKey
  var id = s.id !== undefined && s.id !== null ? s.id : ''
  var studentId = s.studentId !== undefined && s.studentId !== null ? s.studentId : ''
  if (id !== '' && studentId !== '' && s.createdAt) return 'created:' + id + '|' + studentId + '|' + s.createdAt
  var studentKey = s.studentUid || s.studentCloudId || studentId || ''
  var slot = [studentKey, s.date || '', s.startTime || '', s.type || '', s.linkedHistoryTs || '', s.plannedAmount || ''].join('|')
  if (slot.replace(/\|/g, '')) return 'slot:' + slot
  if (s.scheduleUid) return 'scheduleUid:' + s.scheduleUid
  if (s._cloudId || s._id) return 'cloud:' + (s._cloudId || s._id)
  return ''
}

function scheduleSlotIdentity(s) {
  if (!s) return ''
  var studentKey = s.studentUid || s.studentCloudId || s.studentId || ''
  var slot = [studentKey, s.date || '', s.startTime || '', s.type || '', s.linkedHistoryTs || '', s.plannedAmount || ''].join('|')
  return slot.replace(/\|/g, '') ? 'slot:' + slot : ''
}

function normalizeSchedulesBySlot(schedules) {
  var map = {}, order = [], result = []
  schedules = schedules || []
  for (var i = 0; i < schedules.length; i++) {
    var item = schedules[i]
    if (!item) continue
    var key = scheduleIdentity(item) || scheduleSlotIdentity(item) || ('idx:' + i)
    if (!map[key]) order.push(key)
    map[key] = mergeScheduleRecord(map[key], item)
  }
  for (var j = 0; j < order.length; j++) result.push(map[order[j]])
  return result
}

function mergeScheduleRecord(a, b) {
  if (!a) return b
  if (!b) return a
  var best = newerSchedule(a, b)
  var other = best === a ? b : a
  copyScheduleMissing(best, other)
  return best
}

function copyScheduleMissing(target, source) {
  if (!target || !source) return
  var keys = ['_cloudId', 'localKey', 'scheduleUid', 'studentUid', 'studentCloudId', 'studentName', 'avatarSrc', 'beforeRemaining', 'beforeLastClassDate', 'originalDate', 'originalStartTime', 'linkedHistoryTs']
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]
    if ((target[k] === undefined || target[k] === null || target[k] === '') && source[k] !== undefined && source[k] !== null && source[k] !== '') {
      target[k] = source[k]
    }
  }
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

function scheduleRank(s) {
  if (!s) return 0
  if (s.deleted || s.status === schedule.STATUS.DELETED) return 4
  if (s.status === schedule.STATUS.COMPLETED) return 3
  if (s.status === schedule.STATUS.CANCELED) return 2
  return 1
}

function updateNextScheduleId(app) {
  var next = app.globalData.nextScheduleId || 0
  var schedules = app.globalData.schedules || []
  for (var i = 0; i < schedules.length; i++) {
    var sid = parseInt(schedules[i].id)
    if (!isNaN(sid) && sid >= next) next = sid + 1
  }
  app.globalData.nextScheduleId = next
}

function mergeCloudToLocal(local, cs) {
  ensureStudentUid(local)
  ensureStudentUid(cs)
  var cloudNewer = (cs.updatedAt || cs.lastModified || 0) >= (local.updatedAt || local.lastModified || 0)
  var mergedHistory = mergeHistory(local.history || [], cs.history || [])
  if (cloudNewer) {
    local.name = hasCloudField(cs, 'name') ? cs.name : local.name
    local.avatarSrc = hasCloudField(cs, 'avatarSrc') ? cs.avatarSrc : local.avatarSrc
    local.expiryDate = hasCloudField(cs, 'expiryDate') ? cs.expiryDate : local.expiryDate
    local.note = hasCloudField(cs, 'note') ? cs.note : local.note
    local.lastClassDate = hasCloudField(cs, 'lastClassDate') ? cs.lastClassDate : local.lastClassDate
    local.deleted = hasCloudField(cs, 'deleted') ? cs.deleted : (local.deleted || false)
    local.deletedAt = hasCloudField(cs, 'deletedAt') ? cs.deletedAt : (local.deletedAt || '')
  }
  local.history = mergedHistory
  if (cloudNewer) {
    local.totalLessons = hasCloudField(cs, 'totalLessons') ? cs.totalLessons : local.totalLessons
    local.remainingLessons = hasCloudField(cs, 'remainingLessons') ? cs.remainingLessons : local.remainingLessons
  }
  local.lastModified = Math.max(local.lastModified || 0, cs.lastModified || 0)
  local.updatedAt = Math.max(local.updatedAt || local.lastModified || 0, cs.updatedAt || cs.lastModified || 0)
  local.createdAt = hasCloudField(cs, 'createdAt') ? cs.createdAt : local.createdAt
  local.studentUid = cs.studentUid || local.studentUid
  local._cloudId = cs._cloudId || cs._id || local._cloudId
  local._dirty = false
  return local
}

function hasCloudField(obj, key) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined && obj[key] !== null
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

function normalizeStudentIdentity(student) {
  if (!student) return ''
  var legacy = legacyStudentKey(student)
  if (student.studentUid && !isCloudDerivedStudentUid(student.studentUid)) return 'uid:' + student.studentUid
  if (legacy) return 'legacy:' + legacy
  if (student.studentUid) return 'uid:' + student.studentUid
  if (student._cloudId || student._id) return 'cloud:' + (student._cloudId || student._id)
  if (student.id !== undefined && student.id !== null && student.id !== '') return 'id:' + student.id
  return ''
}

function mergeStudentRecord(target, source) {
  if (!target) return source
  if (!source) return target
  var dirty = !!(target._dirty || source._dirty)
  var merged = mergeCloudToLocal(target, source)
  merged._dirty = dirty
  return merged
}

function normalizeStudents(students) {
  students = students || []
  var map = {}, order = [], list = []
  for (var i = 0; i < students.length; i++) {
    if (students[i]) {
      ensureStudentUid(students[i])
      students[i].history = normalizeHistory(students[i].history || [])
      students[i].updatedAt = students[i].updatedAt || students[i].lastModified || 0
      var key = normalizeStudentIdentity(students[i]) || ('idx:' + i)
      if (!map[key]) order.push(key)
      map[key] = mergeStudentRecord(map[key], students[i])
    }
  }
  for (var j = 0; j < order.length; j++) list.push(map[order[j]])
  return list
}

function mergeHistory(a, b) {
  return normalizeHistory((a || []).concat(b || []))
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

function pickCloudStudentId(student, usedMap, nextId) {
  var candidates = [student.studentLocalId, student.id]
  for (var i = 0; i < candidates.length; i++) {
    var id = toStudentId(candidates[i])
    if (id !== null && !usedMap[id]) return id
  }
  var next = toStudentId(nextId)
  if (next === null) next = 0
  while (usedMap[next]) next++
  return next
}

function repairScheduleStudentLinks(schedules, students) {
  var changed = false
  var byId = {}
  var byCloud = {}
  var byUid = {}
  for (var i = 0; i < (students || []).length; i++) {
    var st = students[i]
    if (!st || st.deleted) continue
    ensureStudentUid(st)
    byId[st.id] = st
    if (st._cloudId) byCloud[st._cloudId] = st
    if (st.studentUid) byUid[st.studentUid] = st
  }
  for (var j = 0; j < (schedules || []).length; j++) {
    var sc = schedules[j]
    if (!sc || sc.deleted) continue
    var matched = null
    if (sc.studentUid && byUid[sc.studentUid]) matched = byUid[sc.studentUid]
    else if (sc.studentUid) continue
    else if (sc.studentCloudId && byCloud[sc.studentCloudId]) matched = byCloud[sc.studentCloudId]
    else if (sc.studentCloudId) continue
    else if (byId[sc.studentId]) {
      if (sc.studentName && byId[sc.studentId].name && sc.studentName !== byId[sc.studentId].name) continue
      matched = byId[sc.studentId]
    }
    if (!matched) continue
    sc.studentId = matched.id
    sc.studentName = matched.name || sc.studentName || ''
    sc.avatarSrc = matched.avatarSrc || sc.avatarSrc || ''
    sc.studentUid = matched.studentUid || sc.studentUid || ''
    sc.studentCloudId = matched._cloudId || sc.studentCloudId || ''
    sc.updatedAt = Date.now()
    changed = true
  }
  return changed
}

function toStudentId(v) {
  if (typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0) return v
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return parseInt(v, 10)
  return null
}

function normalizeStudentIds(students, schedules, nextId) {
  var list = students || []
  var scs = schedules || []
  var used = {}
  var maxId = -1
  var changed = false
  for (var i = 0; i < list.length; i++) {
    var n = toStudentId(list[i].id)
    if (n !== null && n > maxId) maxId = n
  }
  var next = toStudentId(nextId)
  if (next === null) next = 0
  if (next <= maxId) {
    next = maxId + 1
    changed = true
  }
  for (var j = 0; j < list.length; j++) {
    var student = list[j]
    var oldId = student.id
    var id = toStudentId(oldId)
    if (id === null || used[id]) {
      var newId = next
      while (used[newId]) newId++
      student.id = newId
      used[newId] = true
      next = newId + 1
      changed = true
      syncScheduleStudentId(scs, oldId, newId, student)
    } else {
      if (student.id !== id) {
        student.id = id
        changed = true
      }
      used[id] = true
    }
  }
  return { changed: changed, nextId: next }
}

function syncScheduleStudentId(schedules, oldId, newId, student) {
  if (oldId === undefined || oldId === null || oldId === '') return
  for (var i = 0; i < (schedules || []).length; i++) {
    var sc = schedules[i]
    if (!sc || sc.studentId != oldId) continue
    var nameMatched = student.name && sc.studentName && sc.studentName === student.name
    var avatarMatched = student.avatarSrc && sc.avatarSrc && sc.avatarSrc === student.avatarSrc
    if (!nameMatched && !avatarMatched) continue
    sc.studentId = newId
    sc.studentName = student.name || sc.studentName || ''
    sc.avatarSrc = student.avatarSrc || sc.avatarSrc || ''
    sc.updatedAt = Date.now()
  }
}
