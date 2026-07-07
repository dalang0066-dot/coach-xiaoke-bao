var U = require('./util.js')

var TYPE = { SCHEDULED: 'scheduled', WALK_IN: 'walkIn' }
var STATUS = { SCHEDULED: 'scheduled', COMPLETED: 'completed', CANCELED: 'canceled', DELETED: 'deleted' }
var STATE = { UPCOMING: 'upcoming', IN_PROGRESS: 'inProgress', OVERDUE: 'overdue', COMPLETED: 'completed', CANCELED: 'canceled', DELETED: 'deleted' }

var LESSON_MINUTES = 60
var GRACE_MINUTES = 15
var RETENTION_DAYS = 730

function p2(n) { return (n < 10 ? '0' : '') + n }

function dateParts(ds) {
  var p = (ds || '').split('-')
  return { y: parseInt(p[0]) || 1970, m: parseInt(p[1]) || 1, d: parseInt(p[2]) || 1 }
}

function timeParts(ts) {
  var p = (ts || '00:00').split(':')
  return { h: parseInt(p[0]) || 0, m: parseInt(p[1]) || 0 }
}

function toDateTime(date, time) {
  var d = dateParts(date)
  var t = timeParts(time)
  return new Date(d.y, d.m - 1, d.d, t.h, t.m, 0, 0)
}

function toDate(date) {
  var d = dateParts(date)
  return new Date(d.y, d.m - 1, d.d, 0, 0, 0, 0)
}

function fromDate(d) {
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
}

function addDays(date, n) {
  var d = toDate(date)
  d.setDate(d.getDate() + n)
  return fromDate(d)
}

function monthValue(year, month) {
  return year + '-' + p2(month)
}

function formatAmount(n) {
  n = parseFloat(n)
  if (isNaN(n)) return ''
  n = Math.round(n * 10) / 10
  return n % 1 === 0 ? String(parseInt(n)) : n.toFixed(1)
}

function parseAmount(v, fallback) {
  var n = parseFloat(v)
  if (isNaN(n)) return fallback === undefined ? 0 : fallback
  n = Math.round(n * 10) / 10
  return n > 0 ? n : (fallback === undefined ? 0 : fallback)
}

function cleanHalfAmountInput(raw, max) {
  var s = String(raw || '').replace(/[^\d.]/g, '')
  var dot = s.indexOf('.')
  if (dot !== -1) {
    s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '')
  }
  if (s.charAt(0) === '.') s = '0' + s
  var invalidHalf = false
  if (s.indexOf('.') !== -1) {
    var parts = s.split('.')
    if (parts[1].length > 0) {
      if (parts[1].charAt(0) === '5') {
        s = parts[0] + '.5'
      } else {
        s = parts[0]
        invalidHalf = true
      }
    }
  }
  var amount = parseFloat(s)
  if (isNaN(amount)) amount = 0
  var capped = false
  if (max !== undefined && max !== null) {
    var mx = parseFloat(max)
    if (!isNaN(mx) && amount > mx) {
      amount = mx
      s = formatAmount(mx)
      capped = true
    }
  }
  return { value: s, amount: amount, capped: capped, invalidHalf: invalidHalf }
}

function plannedAmount(s) {
  return parseAmount(s && s.plannedAmount, 1)
}

function actualAmount(s) {
  var n = parseAmount(s && s.actualAmount, 0)
  return n > 0 ? n : plannedAmount(s)
}

function lessonDiff(actual, planned) {
  actual = parseAmount(actual, 0)
  planned = parseAmount(planned, 0)
  if (actual <= 0 || planned <= 0) return { extra: 0, less: 0 }
  return {
    extra: Math.max(0, Math.round((actual - planned) * 10) / 10),
    less: Math.max(0, Math.round((planned - actual) * 10) / 10)
  }
}

function startTs(s) {
  return toDateTime(s.date, s.startTime || '00:00').getTime()
}

function endTs(s) {
  return startTs(s) + plannedAmount(s) * LESSON_MINUTES * 60000
}

function graceTs(s) {
  return endTs(s) + GRACE_MINUTES * 60000
}

function isHidden(s) {
  return !s || s.deleted || s.status === STATUS.DELETED || s.status === STATUS.CANCELED
}

function stateOf(s, nowTs) {
  if (!s) return STATE.DELETED
  if (s.deleted || s.status === STATUS.DELETED) return STATE.DELETED
  if (s.status === STATUS.CANCELED) return STATE.CANCELED
  if (s.status === STATUS.COMPLETED) return STATE.COMPLETED
  var now = nowTs || Date.now()
  if (now > graceTs(s)) return STATE.OVERDUE
  if (now >= startTs(s)) return STATE.IN_PROGRESS
  return STATE.UPCOMING
}

function isActive(s, nowTs) {
  var st = stateOf(s, nowTs)
  return st === STATE.UPCOMING || st === STATE.IN_PROGRESS || st === STATE.OVERDUE
}

function stateText(st) {
  if (st === STATE.OVERDUE) return '未消课'
  if (st === STATE.IN_PROGRESS) return '上课中'
  if (st === STATE.COMPLETED) return '已消课'
  if (st === STATE.CANCELED) return '已取消'
  return '待上课'
}

function formatHM(time) {
  return (time || '00:00').slice(0, 5)
}

function formatTsHM(ts) {
  var d = new Date(ts)
  return p2(d.getHours()) + ':' + p2(d.getMinutes())
}

function formatDateShort(date) {
  var d = dateParts(date)
  return p2(d.m) + '/' + p2(d.d)
}

function formatDateLabel(date, today) {
  var diff = U.daysBetween(today || U.today(), date)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === 2) return '后天'
  return formatDateShort(date)
}

function formatChip(s, today) {
  return formatDateLabel(s.date, today) + ' ' + formatHM(s.startTime)
}

function weekdayLabel(date) {
  var w = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return w[toDate(date).getDay()]
}

function dateTitle(date) {
  var d = dateParts(date)
  return d.m + '月' + d.d + '日 ' + weekdayLabel(date)
}

function timeRange(s) {
  return formatHM(s.startTime) + ' - ' + formatTsHM(endTs(s))
}

function overdueDays(s, nowTs) {
  var now = nowTs || Date.now()
  if (now <= endTs(s)) return 0
  return Math.max(1, Math.ceil((now - endTs(s)) / 86400000))
}

function stateTone(st) {
  if (st === STATE.OVERDUE) return 'red'
  if (st === STATE.COMPLETED) return 'gray'
  if (st === STATE.IN_PROGRESS) return 'darkgreen'
  return 'green'
}

function buildStudentMeta(schedules, studentId, today, nowTs) {
  var meta = {
    chips: [],
    overdueCount: 0,
    todayCount: 0,
    earliestOverdueTs: 0,
    todayTs: 0,
    nextTs: 0,
    statusState: '',
    statusText: '',
    statusTone: '',
    statusTs: 0
  }
  for (var i = 0; i < (schedules || []).length; i++) {
    var s = schedules[i]
    if (isHidden(s) || s.studentId != studentId || !isActive(s, nowTs)) continue
    var st = stateOf(s, nowTs)
    var ts = startTs(s)
    var amt = plannedAmount(s)
    var rank = st === STATE.OVERDUE ? 0 : (st === STATE.IN_PROGRESS ? 1 : 2)
    var currentRank = meta.statusState === STATE.OVERDUE ? 0 : (meta.statusState === STATE.IN_PROGRESS ? 1 : (meta.statusState ? 2 : 9))
    if (rank < currentRank || (rank === currentRank && (!meta.statusTs || ts < meta.statusTs))) {
      meta.statusState = st
      meta.statusText = stateText(st)
      meta.statusTone = stateTone(st)
      meta.statusTs = ts
    }
    if (st === STATE.OVERDUE) {
      meta.overdueCount += amt
      if (!meta.earliestOverdueTs || ts < meta.earliestOverdueTs) meta.earliestOverdueTs = ts
    } else {
      if (!meta.nextTs || ts < meta.nextTs) meta.nextTs = ts
      if (s.date === today) {
        meta.todayCount += amt
        if (!meta.todayTs || ts < meta.todayTs) meta.todayTs = ts
      }
    }
    meta.chips.push({
      id: s.id,
      label: formatChip(s, today),
      state: st,
      overdue: st === STATE.OVERDUE
    })
  }
  meta.chips.sort(function (a, b) {
    var sa = findById(schedules, a.id)
    var sb = findById(schedules, b.id)
    var ao = a.overdue ? 0 : 1
    var bo = b.overdue ? 0 : 1
    if (ao !== bo) return ao - bo
    return startTs(sa) - startTs(sb)
  })
  meta.chips = meta.chips.slice(0, 3)
  return meta
}

function buildAllStudentMeta(schedules, students, today, nowTs) {
  var map = {}
  for (var i = 0; i < (students || []).length; i++) {
    if (students[i].deleted) continue
    map[students[i].id] = buildStudentMeta(schedules, students[i].id, today, nowTs)
  }
  return map
}

function summarizeBadge(schedules, students, today, nowTs) {
  if (typeof students === 'string') {
    nowTs = today
    today = students
    students = null
  }
  var refs = students ? studentRefs(students) : null
  var red = 0
  for (var i = 0; i < (schedules || []).length; i++) {
    var s = schedules[i]
    if (isHidden(s)) continue
    if (refs && !hasActiveStudent(s, refs)) continue
    var st = stateOf(s, nowTs)
    if (st === STATE.OVERDUE) red += plannedAmount(s)
  }
  return { red: red, green: 0, count: red, tone: red ? 'red' : '' }
}

function summarizeDay(schedules, students, date, nowTs) {
  if (typeof students === 'string') {
    nowTs = date
    date = students
    students = null
  }
  var refs = students ? studentRefs(students) : null
  var red = 0
  var green = 0
  var gray = 0
  var today = U.today()
  for (var i = 0; i < (schedules || []).length; i++) {
    var s = schedules[i]
    if (isHidden(s) || s.date !== date) continue
    if (refs && !hasActiveStudent(s, refs)) continue
    var st = stateOf(s, nowTs)
    if (st === STATE.COMPLETED) {
      if (date <= today) gray += actualAmount(s)
    } else if (st === STATE.OVERDUE) {
      red += plannedAmount(s)
    } else if (date >= today) {
      green += plannedAmount(s)
    }
  }
  if (green > 0) gray = 0
  return { red: red, green: green, gray: gray }
}

function studentMap(students) {
  var map = {}
  for (var i = 0; i < (students || []).length; i++) {
    if (!students[i] || students[i].deleted) continue
    map[students[i].id] = students[i]
  }
  return map
}

function studentRefs(students) {
  var refs = { byId: {}, byUid: {}, byCloud: {} }
  for (var i = 0; i < (students || []).length; i++) {
    var st = students[i]
    if (!st || st.deleted) continue
    refs.byId[st.id] = st
    if (st.studentUid) refs.byUid[st.studentUid] = st
    if (st._cloudId) refs.byCloud[st._cloudId] = st
  }
  return refs
}

function hasActiveStudent(s, refs) {
  if (!refs || !s) return true
  if (s.studentUid) return !!refs.byUid[s.studentUid]
  if (s.studentCloudId) return !!refs.byCloud[s.studentCloudId]
  var st = refs.byId[s.studentId]
  if (!st) return false
  if (s.studentName && st.name && s.studentName !== st.name) return false
  return true
}

function decorate(s, studentsById, nowTs) {
  var stu = studentsById ? studentsById[s.studentId] : null
  var st = stateOf(s, nowTs)
  var planned = plannedAmount(s)
  var actual = actualAmount(s)
  var completed = st === STATE.COMPLETED
  var displayAmount = completed ? actual : planned
  var earlyCompleted = completed && !!s.earlyCompleted
  var overAmount = (completed && !earlyCompleted) ? Math.max(0, Math.round((actual - planned) * 10) / 10) : 0
  var underAmount = (completed && !earlyCompleted) ? Math.max(0, Math.round((planned - actual) * 10) / 10) : 0
  return {
    id: s.id,
    studentId: s.studentId,
    studentName: (stu && stu.name) || s.studentName || '',
    avatarSrc: (stu && stu.avatarSrc) || s.avatarSrc || '/images/avatars/avatar_1.png',
    remainingLessons: stu ? stu.remainingLessons : '',
    date: s.date,
    dateShort: formatDateShort(s.date),
    dateTitle: dateTitle(s.date),
    weekday: weekdayLabel(s.date),
    startTime: formatHM(s.startTime),
    endTime: formatTsHM(endTs(s)),
    timeRange: timeRange(s),
    plannedAmount: planned,
    plannedAmountText: formatAmount(planned),
    actualAmount: actual,
    actualAmountText: formatAmount(actual),
    displayAmount: displayAmount,
    displayAmountText: formatAmount(displayAmount),
    overAmount: overAmount,
    overAmountText: formatAmount(overAmount),
    underAmount: underAmount,
    underAmountText: formatAmount(underAmount),
    earlyCompleted: earlyCompleted,
    note: s.note || '',
    completeNote: s.completeNote || '',
    type: s.type || TYPE.SCHEDULED,
    status: s.status || STATUS.SCHEDULED,
    state: st,
    stateText: stateText(st),
    stateTone: stateTone(st),
    overdue: st === STATE.OVERDUE,
    overdueDays: overdueDays(s, nowTs),
    inProgress: st === STATE.IN_PROGRESS,
    completed: completed,
    startTs: startTs(s)
  }
}

function getDaySchedules(schedules, students, date, nowTs) {
  var map = studentMap(students)
  var refs = studentRefs(students)
  var arr = []
  for (var i = 0; i < (schedules || []).length; i++) {
    var s = schedules[i]
    if (isHidden(s) || s.date !== date) continue
    if (!hasActiveStudent(s, refs)) continue
    arr.push(decorate(s, map, nowTs))
  }
  arr.sort(function (a, b) {
    var pa = a.overdue ? 0 : (a.completed ? 2 : 1)
    var pb = b.overdue ? 0 : (b.completed ? 2 : 1)
    if (pa !== pb) return pa - pb
    return a.startTs - b.startTs
  })
  return arr
}

function getRecentSchedules(schedules, students, today, nowTs, days) {
  var end = addDays(today, days || 7)
  var map = studentMap(students)
  var refs = studentRefs(students)
  var arr = []
  for (var i = 0; i < (schedules || []).length; i++) {
    var s = schedules[i]
    if (isHidden(s) || !isActive(s, nowTs)) continue
    if (!hasActiveStudent(s, refs)) continue
    if (s.date > end && stateOf(s, nowTs) !== STATE.OVERDUE) continue
    arr.push(decorate(s, map, nowTs))
  }
  arr.sort(function (a, b) {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    return a.startTs - b.startTs
  })
  return arr
}

function activeStateRank(st) {
  if (st === STATE.OVERDUE) return 0
  if (st === STATE.IN_PROGRESS) return 1
  if (st === STATE.UPCOMING) return 2
  return 9
}

function getStudentActiveSchedules(schedules, students, studentId, nowTs) {
  var map = studentMap(students)
  var arr = []
  for (var i = 0; i < (schedules || []).length; i++) {
    var s = schedules[i]
    if (isHidden(s) || s.studentId != studentId || s.status !== STATUS.SCHEDULED) continue
    var st = stateOf(s, nowTs)
    if (activeStateRank(st) > 2) continue
    arr.push(decorate(s, map, nowTs))
  }
  arr.sort(function (a, b) {
    var ar = activeStateRank(a.state)
    var br = activeStateRank(b.state)
    if (ar !== br) return ar - br
    return a.startTs - b.startTs
  })
  return arr
}

function findById(schedules, id) {
  for (var i = 0; i < (schedules || []).length; i++) {
    if (schedules[i].id == id) return schedules[i]
  }
  return null
}

function cleanOld(schedules, today) {
  var minDate = addDays(today || U.today(), -RETENTION_DAYS)
  var arr = []
  for (var i = 0; i < (schedules || []).length; i++) {
    var s = schedules[i]
    if (!s) continue
    if (s.deleted || s.status === STATUS.DELETED || s.status === STATUS.CANCELED) continue
    if (s.status === STATUS.SCHEDULED && !s.deleted) {
      arr.push(s)
      continue
    }
    if ((s.date || '') >= minDate) arr.push(s)
  }
  return arr
}

function nextRefreshTs(schedules, nowTs) {
  var now = nowTs || Date.now()
  var d = new Date(now)
  var midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 1, 0).getTime()
  var next = midnight
  var hasActiveSchedule = false
  for (var i = 0; i < (schedules || []).length; i++) {
    var s = schedules[i]
    if (isHidden(s) || s.status !== STATUS.SCHEDULED) continue
    hasActiveSchedule = true
    var st = startTs(s)
    var gt = graceTs(s)
    if (st > now && st < next) next = st
    if (gt > now && gt < next) next = gt
  }
  if (!hasActiveSchedule) return 0
  return next
}

module.exports = {
  TYPE: TYPE,
  STATUS: STATUS,
  STATE: STATE,
  LESSON_MINUTES: LESSON_MINUTES,
  GRACE_MINUTES: GRACE_MINUTES,
  toDate: toDate,
  toDateTime: toDateTime,
  fromDate: fromDate,
  addDays: addDays,
  monthValue: monthValue,
  formatAmount: formatAmount,
  parseAmount: parseAmount,
  cleanHalfAmountInput: cleanHalfAmountInput,
  plannedAmount: plannedAmount,
  actualAmount: actualAmount,
  lessonDiff: lessonDiff,
  startTs: startTs,
  endTs: endTs,
  graceTs: graceTs,
  stateOf: stateOf,
  stateText: stateText,
  isActive: isActive,
  isHidden: isHidden,
  formatHM: formatHM,
  formatTsHM: formatTsHM,
  formatDateShort: formatDateShort,
  formatChip: formatChip,
  weekdayLabel: weekdayLabel,
  dateTitle: dateTitle,
  timeRange: timeRange,
  overdueDays: overdueDays,
  stateTone: stateTone,
  buildStudentMeta: buildStudentMeta,
  buildAllStudentMeta: buildAllStudentMeta,
  summarizeBadge: summarizeBadge,
  summarizeDay: summarizeDay,
  getDaySchedules: getDaySchedules,
  getRecentSchedules: getRecentSchedules,
  getStudentActiveSchedules: getStudentActiveSchedules,
  findById: findById,
  cleanOld: cleanOld,
  nextRefreshTs: nextRefreshTs
}
