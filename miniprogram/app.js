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
    proExpiry: '',
    welcomeReward: 0,
    pendingReward: 0,
    upgradeShown: false,
    _pendingWelcome: null,
    bannerDismissedToday: {},
    statusBarHeight: 20
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
    this.globalData.memberExpired = data.memberExpired || false
    this.globalData.isProMember = data.isProMember || false
    this.globalData.proExpiry = data.proExpiry || data.easterProExpiry || ''
    // Pro过期检测
    if (this.globalData.proExpiry && today >= this.globalData.proExpiry) {
      this.globalData.isProMember = false
      this.globalData.memberExpired = true
      this.globalData.proExpiry = ''
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
    cloud.pullMember(function (isPro, expired, proExp, welcomeDays, pendingDays, upgradeShown) {
      if (isPro !== null) {
        that.globalData.isProMember = !!isPro
        that.globalData.memberExpired = !!expired
        that.globalData.proExpiry = proExp || ''
        that.globalData.welcomeReward = welcomeDays || 0
        that.globalData.pendingReward = pendingDays || 0
        that.globalData.upgradeShown = !!upgradeShown
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
          // _cloudId 匹配失败，用姓名+创建时间兜底匹配（防止首次同步后 _cloudId 未及时存入本地导致重复）
          for (var m = 0; m < local.length; m++) {
            if (local[m].name === cs.name && local[m].createdAt === cs.createdAt) {
              local[m] = mergeCloudToLocal(local[m], cs); found = true; break
            }
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
      var wasEmpty = local.length === 0
      that.globalData.students = list
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
  },

  save: function () {
    var key = 'app_data_' + this.globalData.openid
    wx.setStorageSync(key, {
      students: this.globalData.students,
      nextId: this.globalData.nextId,
      memberExpired: this.globalData.memberExpired,
      isProMember: this.globalData.isProMember,
      proExpiry: this.globalData.proExpiry,
      bannerDismissedToday: this.globalData.bannerDismissedToday
    })
    // 云端同步（静默，失败不阻塞）
    if (cloud.isReady()) {
      cloud.syncMember(this.globalData.isProMember, this.globalData.memberExpired, this.globalData.proExpiry, this.globalData.upgradeShown)
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
