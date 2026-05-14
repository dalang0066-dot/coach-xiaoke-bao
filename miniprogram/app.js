var util = require('./utils/util.js')

App({
  globalData: {
    openid: '',
    students: [],
    nextId: 0,
    memberExpired: false,
    isProMember: false,
    bannerDismissedToday: {},
    statusBarHeight: 20
  },

  onLaunch: function () {
    var that = this
    var sys = wx.getSystemInfoSync()
    this.globalData.statusBarHeight = sys.statusBarHeight

    // 本地持久化身份（每次启动保持一致，数据不丢失）
    this.globalData.openid = this.getLocalId()
    this.loadData()

    // 静默登录：获取微信code备用（后续对接后端换取真实openid后启用云端同步）
    wx.login({
      success: function (res) {
        if (res.code) { that.globalData._wxCode = res.code }
      }
    })
  },

  // 本地设备标识（微信登录失败时的兜底方案）
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

    // 迁移旧数据（无openid版本的数据）
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
    this.globalData.bannerDismissedToday = data.bannerDismissedToday || {}
    if (this.globalData.bannerDismissedToday.date !== today) {
      this.globalData.bannerDismissedToday = { date: today, sleepy: false, expiry: false, memberExpired: false }
    }
  },

  save: function () {
    var key = 'app_data_' + this.globalData.openid
    wx.setStorageSync(key, {
      students: this.globalData.students,
      nextId: this.globalData.nextId,
      memberExpired: this.globalData.memberExpired,
      isProMember: this.globalData.isProMember,
      bannerDismissedToday: this.globalData.bannerDismissedToday
    })
  }
})
