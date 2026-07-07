var C = require('./cloud.js')

function persistLater() {
  try { getApp().save() } catch (e) {}
}

function hasRealOpenid() {
  try {
    var app = getApp()
    return !!(app && app.globalData && app.globalData._realOpenid)
  } catch (e) {
    return false
  }
}

function syncStudentSafe(student) {
  if (!student) return
  student.updatedAt = Math.max(student.updatedAt || 0, student.lastModified || 0, Date.now())
  student._dirty = true
  if (!C.isReady() || !hasRealOpenid()) {
    persistLater()
    return
  }
  if (C.isOnline()) {
    C.syncStudent(student, function (err) {
      if (err) C.queueOp('save', student)
    })
  } else {
    C.queueOp('save', student)
  }
}

function syncScheduleSafe(schedule) {
  if (!schedule) return
  C.ensureScheduleLocalKey(schedule)
  schedule.updatedAt = schedule.updatedAt || Date.now()
  schedule._dirty = true
  if (!C.isReady() || !hasRealOpenid()) {
    persistLater()
    return
  }
  if (C.isOnline()) {
    C.syncSchedule(schedule, function (err) {
      if (err) C.queueOp('saveSchedule', schedule)
    })
  } else {
    C.queueOp('saveSchedule', schedule)
  }
}

module.exports = {
  syncStudentSafe: syncStudentSafe,
  syncScheduleSafe: syncScheduleSafe
}
