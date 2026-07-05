var util = require('./utils/util.js')
var cloud = require('./utils/cloud.js')
var analytics = require('./utils/analytics.js')
var schedule = require('./utils/schedule.js')

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
    _lastMemberSyncKey: ''
  },

  onLaunch: function () {
    var that = this
    var sys = wx.getSystemInfoSync()
    this.globalData.statusBarHeight = sys.statusBarHeight

    // 隐私授权（用户首次打开时弹窗同意隐私政策）
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({
        success: function () {},
        fail: function () {}
      })
    }

    // 本地持久化身份
    this.globalData.openid = this.getLocalId()
    this.loadData()
    analytics.track('launch')

    // 静默登录：获取微信code备用
    wx.login({
      success: function (res) {
        if (res.code) { that.globalData._wxCode = res.code }
      }
    })

    // 初始化云开发（未开通时静默跳过）
    cloud.init()

    // 处理分享推荐（需在getOpenid之前拿到ref）
    var opts = wx.getLaunchOptionsSync()
    var refId = (opts.query && opts.query.ref) ? opts.query.ref : ''

    if (cloud.isReady()) {
      // 获取微信真实openid，拿到后再拉云端数据
      wx.cloud.callFunction({ name: 'getOpenid' }).then(function (res) {
        if (res.result && res.result.openid) {
          that.globalData._realOpenid = res.result.openid
        }
        // openid就位了，现在拉云端数据
        if (refId) that.globalData._pendingRef = refId
        if (wx.getStorageSync('_pending_easter_sync')) {
          that.globalData._skipMemberPullOnce = true
          that.save()
          cloud.syncEasterClaimed()
          wx.removeStorageSync('_pending_easter_sync')
        }
        that.pullCloudData()
        // 同步彩蛋标记
        cloud.pullEasterClaimed(function (claimed) {
          if (claimed) wx.setStorageSync('_easter_egg_claimed', true)
        })
      }).catch(function () {
        // 即使失败也拉数据（会员信息会缺失，但学员数据能拉）
        if (!refId) that.pullCloudData()
      })
    }
  },

  // 本地设备标识
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

    // 迁移旧数据
    if (!data.students || !data.students.length) {
      var oldData = wx.getStorageSync('app_data')
      if (oldData && oldData.students && oldData.students.length) {
        data = oldData
        wx.removeStorageSync('app_data')
      }
    }

    this.globalData.students = data.students || []
    this.globalData.nextId = data.nextId || 0
    this.globalData.schedules = schedule.cleanOld(data.schedules || [], today)
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
    this.globalData.swipeHintDismissed = data.swipeHintDismissed || false
    // Pro过期检测
    if (this.globalData.proExpiry && today > this.globalData.proExpiry) {
      this.globalData.isProMember = false
      this.globalData.memberExpired = true
      this.globalData.proExpiry = ''
    }
    this.globalData.bannerDismissedToday = data.bannerDismissedToday || {}
    if (this.globalData.bannerDismissedToday.date !== today) {
      this.globalData.bannerDismissedToday = { date: today, sleepy: false, expiry: false, memberExpired: false }
    }
    if (idFix.changed) this.save()
  },

  // 云端数据拉取 + 合并（云端优先）
  pullCloudData: function () {
    var that = this
    // 拉取会员状态
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
        that.refreshCurrentPage()
      }
    })
    // 拉取学员数据（本地有活跃学员时跳过，避免云端合并导致重复/丢失）
    var hasLocal = false, ss = that.globalData.students || []
    for (var n = 0; n < ss.length; n++) { if (!ss[n].deleted) { hasLocal = true; break } }
    if (!hasLocal) {
      cloud.pullFromCloud(function (cloudList) {
      if (!cloudList || !cloudList.length) { return }
      var local = that.globalData.students || []
      var merged = {}
      // 先放本地数据
      for (var i = 0; i < local.length; i++) {
        merged[local[i].id] = local[i]
      }
      // 云端覆盖（云端较新则覆盖）
      for (var j = 0; j < cloudList.length; j++) {
        var cs = cloudList[j]
        // 查找本地匹配（通过 _cloudId 或 name+createdAt）
        var found = false
        for (var k = 0; k < local.length; k++) {
          if (local[k]._cloudId === cs._cloudId) {
            if ((cs.lastModified || 0) >= (local[k].lastModified || 0)) {
              local[k] = mergeCloudToLocal(local[k], cs)
            }
            found = true
            break
          }
        }
        if (!found) {
          // _cloudId 匹配失败，用姓名+创建时间兜底匹配（防止首次同步后 _cloudId 未及时存入本地导致重复）
          for (var m = 0; m < local.length; m++) {
            if (local[m].name === cs.name && local[m].createdAt === cs.createdAt) {
              local[m] = mergeCloudToLocal(local[m], cs); found = true; break
            }
          }
        }
        if (!found) {
          var newId = pickCloudStudentId(cs, merged, that.globalData.nextId)
          if (newId >= that.globalData.nextId) that.globalData.nextId = newId + 1
          cs.id = newId
          merged[newId] = cs
        }
      }
      var list = []
      for (var key in merged) { if (merged.hasOwnProperty(key)) list.push(merged[key]) }
      var wasEmpty = local.length === 0
      that.globalData.students = list
      repairScheduleStudentLinks(that.globalData.schedules || [], that.globalData.students || [])
      that.save()
      // 本地没数据但云端有 → 刷新页面显示云端数据
      if (wasEmpty && list.length > 0) {
        setTimeout(function () {
          var pages = getCurrentPages()
          if (pages.length > 0 && pages[pages.length - 1].reload) {
            pages[pages.length - 1].reload()
          }
        }, 300)
      }
      })
    }
    cloud.pullSchedules(function (cloudSchedules) {
      if (!cloudSchedules || !cloudSchedules.length) {
        syncLocalSchedulesToCloud(that.globalData.schedules || [])
        return
      }
      var localSchedules = that.globalData.schedules || []
      if (!localSchedules.length) {
        that.globalData.schedules = schedule.cleanOld(cloudSchedules, util.today())
        repairScheduleStudentLinks(that.globalData.schedules, that.globalData.students || [])
        updateNextScheduleId(that)
        that.save()
        that.refreshCurrentPage()
      } else {
        var changed = mergeScheduleCloudIds(localSchedules, cloudSchedules)
        if (mergeMissingCloudSchedules(localSchedules, cloudSchedules)) changed = true
        if (repairScheduleStudentLinks(localSchedules, that.globalData.students || [])) changed = true
        if (changed) {
          that.globalData.schedules = schedule.cleanOld(localSchedules, util.today())
          updateNextScheduleId(that)
        }
        syncLocalSchedulesToCloud(that.globalData.schedules || localSchedules)
        if (changed) that.save()
      }
    })
  },

  save: function () {
    var key = 'app_data_' + this.globalData.openid
    this.globalData.schedules = schedule.cleanOld(this.globalData.schedules || [], util.today())
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
      bannerDismissedToday: this.globalData.bannerDismissedToday
    })
    // 云端同步（静默，失败不阻塞）
    if (cloud.isReady()) {
      var memberKey = [this.globalData.isProMember ? 1 : 0, this.globalData.memberExpired ? 1 : 0, this.globalData.proExpiry || '', this.globalData.upgradeShown ? 1 : 0].join('|')
      var that = this
      if (memberKey !== this.globalData._lastMemberSyncKey) {
        cloud.syncMember(this.globalData.isProMember, this.globalData.memberExpired, this.globalData.proExpiry, this.globalData.upgradeShown, function (err) {
          if (!err) that.globalData._lastMemberSyncKey = memberKey
        })
      }
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

// 云端数据合并到本地记录（保留本地字段结构）
function syncLocalSchedulesToCloud(schedules) {
  if (!cloud.isReady() || !cloud.isOnline()) return
  for (var i = 0; i < (schedules || []).length; i++) {
    if (!schedules[i] || schedules[i]._cloudId) continue
    cloud.ensureScheduleLocalKey(schedules[i])
    cloud.syncSchedule(schedules[i], function (err) {
      if (err) {
        // 单条失败会在下次具体修改时重新入队，启动补同步不阻塞页面。
      }
    })
  }
}

function mergeScheduleCloudIds(localSchedules, cloudSchedules) {
  var changed = false
  for (var i = 0; i < (cloudSchedules || []).length; i++) {
    var cs = cloudSchedules[i]
    for (var j = 0; j < (localSchedules || []).length; j++) {
      var local = localSchedules[j]
      if (!local || local._cloudId) continue
      if ((local.localKey && cs.localKey && local.localKey === cs.localKey) || (local.id == cs.id && local.studentId == cs.studentId && local.createdAt === cs.createdAt)) {
        local._cloudId = cs._cloudId
        if (!local.localKey && cs.localKey) local.localKey = cs.localKey
        changed = true
        break
      }
    }
  }
  return changed
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
  for (var i = 0; i < (localSchedules || []).length; i++) {
    var local = localSchedules[i]
    if (!local) continue
    if (cloudSchedule._cloudId && local._cloudId === cloudSchedule._cloudId) return true
    if (cloudSchedule.localKey && local.localKey === cloudSchedule.localKey) return true
    if (local.id == cloudSchedule.id && local.createdAt === cloudSchedule.createdAt && local.studentName === cloudSchedule.studentName) return true
  }
  return false
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
  local.name = hasCloudField(cs, 'name') ? cs.name : local.name
  local.avatarSrc = hasCloudField(cs, 'avatarSrc') ? cs.avatarSrc : local.avatarSrc
  local.totalLessons = hasCloudField(cs, 'totalLessons') ? cs.totalLessons : local.totalLessons
  local.remainingLessons = hasCloudField(cs, 'remainingLessons') ? cs.remainingLessons : local.remainingLessons
  local.expiryDate = hasCloudField(cs, 'expiryDate') ? cs.expiryDate : local.expiryDate
  local.note = hasCloudField(cs, 'note') ? cs.note : local.note
  local.lastClassDate = hasCloudField(cs, 'lastClassDate') ? cs.lastClassDate : local.lastClassDate
  local.lastModified = hasCloudField(cs, 'lastModified') ? cs.lastModified : (local.lastModified || 0)
  local.history = hasCloudField(cs, 'history') ? cs.history : (local.history || [])
  local.deleted = hasCloudField(cs, 'deleted') ? cs.deleted : (local.deleted || false)
  local.deletedAt = hasCloudField(cs, 'deletedAt') ? cs.deletedAt : (local.deletedAt || '')
  local.createdAt = hasCloudField(cs, 'createdAt') ? cs.createdAt : local.createdAt
  local._cloudId = cs._cloudId
  return local
}

function hasCloudField(obj, key) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined && obj[key] !== null
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
  var byProfile = {}
  for (var i = 0; i < (students || []).length; i++) {
    var st = students[i]
    if (!st || st.deleted) continue
    byId[st.id] = st
    if (st._cloudId) byCloud[st._cloudId] = st
    var profileKey = (st.name || '') + '|' + (st.avatarSrc || '')
    byProfile[profileKey] = byProfile[profileKey] ? false : st
  }
  for (var j = 0; j < (schedules || []).length; j++) {
    var sc = schedules[j]
    if (!sc || sc.deleted) continue
    if (byId[sc.studentId]) {
      if (!sc.studentCloudId && byId[sc.studentId]._cloudId) {
        sc.studentCloudId = byId[sc.studentId]._cloudId
        changed = true
      }
      continue
    }
    var matched = null
    if (sc.studentCloudId && byCloud[sc.studentCloudId]) matched = byCloud[sc.studentCloudId]
    if (!matched) matched = byProfile[(sc.studentName || '') + '|' + (sc.avatarSrc || '')]
    if (!matched) continue
    sc.studentId = matched.id
    sc.studentName = matched.name || sc.studentName || ''
    sc.avatarSrc = matched.avatarSrc || sc.avatarSrc || ''
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
