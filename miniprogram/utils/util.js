function today() { var d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) }
function p2(n) { return (n < 10 ? '0' : '') + n }
function addMonths(ds, m) { var d = new Date(ds); d.setMonth(d.getMonth() + m); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) }
function daysBetween(d1, d2) { return Math.floor((new Date(d2) - new Date(d1)) / 86400000) }
function isExp(s) { if (!s.expiryDate) return false; var t = today(); return s.expiryDate < t || s.remainingLessons <= 0 }
function formatTime() { return new Date().toTimeString().slice(0, 5) }
function rem(arr) { return arr[Math.floor(Math.random() * arr.length)] }

var AVATARS = ['/images/avatars/01_01.png','/images/avatars/01_02.png','/images/avatars/01_03.png','/images/avatars/01_04.png','/images/avatars/01_05.png','/images/avatars/01_06.png','/images/avatars/01_07.png','/images/avatars/01_08.png','/images/avatars/01_09.png','/images/avatars/02_01.png','/images/avatars/02_02.png','/images/avatars/02_03.png','/images/avatars/02_04.png','/images/avatars/02_05.png','/images/avatars/02_06.png','/images/avatars/02_07.png','/images/avatars/02_08.png','/images/avatars/02_09.png','/images/avatars/04_01.png','/images/avatars/04_02.png','/images/avatars/04_03.png','/images/avatars/04_04.png','/images/avatars/04_05.png','/images/avatars/04_06.png','/images/avatars/04_07.png','/images/avatars/04_08.png','/images/avatars/04_09.png','/images/avatars/05_01.png','/images/avatars/05_02.png','/images/avatars/05_03.png','/images/avatars/05_04.png','/images/avatars/05_05.png','/images/avatars/05_06.png','/images/avatars/05_07.png','/images/avatars/05_08.png','/images/avatars/05_09.png','/images/avatars/06_01.png','/images/avatars/06_02.png','/images/avatars/06_03.png','/images/avatars/06_04.png','/images/avatars/06_05.png','/images/avatars/06_06.png','/images/avatars/06_07.png','/images/avatars/06_08.png','/images/avatars/06_09.png','/images/avatars/07_01.png','/images/avatars/07_02.png','/images/avatars/07_03.png','/images/avatars/07_04.png','/images/avatars/07_05.png','/images/avatars/07_06.png','/images/avatars/07_07.png','/images/avatars/07_08.png','/images/avatars/07_09.png']

var PLAN = { MONTHLY: 'monthly', YEARLY: 'yearly' }
var REC = { DEDUCT: 'deduct', UNDO: 'undo', RECHARGE: 'recharge' }
var BNR = { SLEEPY: 'sleepy', EXPIRY: 'expiry', MEMBER_EXPIRED: 'memberExpired' }

module.exports = { today: today, p2: p2, addMonths: addMonths, daysBetween: daysBetween, isExp: isExp, formatTime: formatTime, rem: rem, AVATARS: AVATARS, PLAN: PLAN, REC: REC, BNR: BNR }
