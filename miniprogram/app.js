var util = require('./utils/util.js')

App({
  globalData: {
    students: [],
    nextId: 0,
    memberExpired: false,
    isProMember: false,
    bannerDismissedToday: {},
    statusBarHeight: 20
  },

  onLaunch: function () {
    var data = wx.getStorageSync('app_data') || {}
    var today = util.today()
    this.globalData.students = data.students || []
    this.globalData.nextId = data.nextId || 0
    this.globalData.memberExpired = data.memberExpired || false
    this.globalData.isProMember = data.isProMember || false
    this.globalData.bannerDismissedToday = data.bannerDismissedToday || {}
    if (this.globalData.bannerDismissedToday.date !== today) {
      this.globalData.bannerDismissedToday = { date: today, sleepy: false, expiry: false, memberExpired: false }
    }
    var sys = wx.getSystemInfoSync()
    this.globalData.statusBarHeight = sys.statusBarHeight
  },

  save: function () {
    wx.setStorageSync('app_data', {
      students: this.globalData.students,
      nextId: this.globalData.nextId,
      memberExpired: this.globalData.memberExpired,
      isProMember: this.globalData.isProMember,
      bannerDismissedToday: this.globalData.bannerDismissedToday
    })
  }
})
