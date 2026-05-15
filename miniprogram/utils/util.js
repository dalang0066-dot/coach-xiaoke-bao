function today() { var d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) }
function p2(n) { return (n < 10 ? '0' : '') + n }
function addMonths(ds, m) { var d = new Date(ds); d.setMonth(d.getMonth() + m); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) }
function daysBetween(d1, d2) { return Math.floor((new Date(d2) - new Date(d1)) / 86400000) }
function isExp(s) { if (!s.expiryDate) return false; var t = today(); return s.expiryDate < t || s.remainingLessons <= 0 }
function formatTime() { return new Date().toTimeString().slice(0, 5) }
function rem(arr) { return arr[Math.floor(Math.random() * arr.length)] }

var EMOJIS = ['🐯', '🐼', '🐰', '🐱', '🐶', '🐻', '🐨', '🐮', '🐷', '🦊', '🐸', '🐵', '🦁', '🐔', '🐧', '🦄', '🐙', '🦋', '🐬', '🐳', '🦉', '🐺', '🐴', '🦅']

var PLAN = { MONTHLY: 'monthly', YEARLY: 'yearly' }
var REC = { DEDUCT: 'deduct', UNDO: 'undo', RECHARGE: 'recharge' }
var BNR = { SLEEPY: 'sleepy', EXPIRY: 'expiry', MEMBER_EXPIRED: 'memberExpired' }

module.exports = { today: today, p2: p2, addMonths: addMonths, daysBetween: daysBetween, isExp: isExp, formatTime: formatTime, rem: rem, EMOJIS: EMOJIS, PLAN: PLAN, REC: REC, BNR: BNR }
