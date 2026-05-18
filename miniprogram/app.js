var util = require('./utils/util.js')
var cloud = require('./utils/cloud.js')
var analytics = require('./utils/analytics.js')

App({
  globalData: {
    openid: '',
    students: [],
    nextId: 0,
    memberExpired: false,
    isProMember: false,
    easterProExpiry: '',
    bannerDismissedToday: {},
    statusBarHeight: 20
  },

  onLaunch: function () {
    var that = this
    var sys = wx.getSystemInfoSync()
    this.globalData.statusBarHeight = sys.statusBarHeight

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

    // 云端拉取数据合并
    if (cloud.isReady()) {
      that.pullCloudData()
      // 同步彩蛋标记（覆盖本地，防止清缓存重领）
      cloud.pullEasterClaimed(function (claimed) {
        if (claimed) wx.setStorageSync('_easter_egg_claimed', true)
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
    this.globalData.memberExpired = data.memberExpired || false
    this.globalData.isProMember = data.isProMember || false
    this.globalData.easterProExpiry = data.easterProExpiry || ''
    // 彩蛋会员过期检测
    if (this.globalData.easterProExpiry && today >= this.globalData.easterProExpiry) {
      this.globalData.isProMember = false
      this.globalData.memberExpired = true
      this.globalData.easterProExpiry = ''
    }
    this.globalData.bannerDismissedToday = data.bannerDismissedToday || {}
    if (this.globalData.bannerDismissedToday.date !== today) {
      this.globalData.bannerDismissedToday = { date: today, sleepy: false, expiry: false, memberExpired: false }
    }
  },

  // 云端数据拉取 + 合并（云端优先）
  pullCloudData: function () {
    var that = this
    // 拉取会员状态
    cloud.pullMember(function (isPro, expired) {
      if (isPro !== null) {
        that.globalData.isProMember = !!isPro
        that.globalData.memberExpired = !!expired
      }
    })
    // 拉取学员数据
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
          var newId = that.globalData.nextId++
          cs.id = newId
          merged[newId] = cs
        }
      }
      var list = []
      for (var key in merged) { if (merged.hasOwnProperty(key)) list.push(merged[key]) }
      that.globalData.students = list
      that.save()
    })
  },

  save: function () {
    var key = 'app_data_' + this.globalData.openid
    wx.setStorageSync(key, {
      students: this.globalData.students,
      nextId: this.globalData.nextId,
      memberExpired: this.globalData.memberExpired,
      isProMember: this.globalData.isProMember,
      easterProExpiry: this.globalData.easterProExpiry,
      bannerDismissedToday: this.globalData.bannerDismissedToday
    })
    // 云端同步（静默，失败不阻塞）
    if (cloud.isReady()) {
      cloud.syncMember(this.globalData.isProMember, this.globalData.memberExpired)
    }
  }
})

// 云端数据合并到本地记录（保留本地字段结构）
function mergeCloudToLocal(local, cs) {
  local.name = cs.name || local.name
  local.avatarSrc = cs.avatarSrc || local.avatarSrc
  local.totalLessons = cs.totalLessons || local.totalLessons
  local.remainingLessons = cs.remainingLessons || local.remainingLessons
  local.expiryDate = cs.expiryDate || local.expiryDate
  local.note = cs.note || local.note
  local.lastClassDate = cs.lastClassDate || local.lastClassDate
  local.lastModified = cs.lastModified || local.lastModified || 0
  local.history = cs.history || local.history || []
  local.deleted = cs.deleted || false
  local.deletedAt = cs.deletedAt || ''
  local.createdAt = cs.createdAt || local.createdAt
  local._cloudId = cs._cloudId
  return local
}
