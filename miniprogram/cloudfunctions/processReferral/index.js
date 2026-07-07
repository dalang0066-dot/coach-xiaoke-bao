const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async (event) => {
  const referrerId = event && event.referrerId
  const wxContext = cloud.getWXContext()
  const newUserId = wxContext.OPENID

  if (!referrerId || !newUserId) return { code: -1, msg: '参数错误' }
  if (referrerId === newUserId) return { code: -1, msg: '不能邀请自己' }

  try {
    const usersColl = db.collection('users')
    const refsColl = db.collection('referrals')

    const existRef = await refsColl.where({ newUserId: newUserId }).get()
    if (existRef.data && existRef.data.length > 0) {
      return { code: -1, msg: '该用户已被邀请过' }
    }

    // An empty users record can be created automatically during app launch.
    const existUser = await getUsers(usersColl, newUserId)
    const hasActivity = await hasUserActivity(newUserId)
    if (hasActivity || hasMemberState(existUser)) {
      return { code: -1, msg: '该用户不是新用户' }
    }

    var d = new Date()
    d.setDate(d.getDate() + 15)
    var expiry = formatDate(d)

    const referrer = await getUsers(usersColl, referrerId)
    if (referrer.length > 0) {
      var rd = mergeMemberState(referrer, referrerId)
      var isLifetime = rd.isProMember && !rd.memberExpired && !rd.proExpiry
      var upd = { openid: referrerId, isProMember: true, memberExpired: false }
      if (isLifetime) {
        upd.proExpiry = ''
      } else {
        var base = rd.proExpiry > today() ? rd.proExpiry : today()
        upd.proExpiry = addDays(base, 15)
        upd.pendingReward = 15
      }
      await updateUsers(usersColl, referrer, upd)
    } else {
      await usersColl.add({
        data: {
          _openid: referrerId,
          openid: referrerId,
          isProMember: true,
          memberExpired: false,
          proExpiry: expiry,
          pendingReward: 15,
          easterClaimed: false
        }
      })
    }

    const newUserData = {
      openid: newUserId,
      isProMember: true,
      memberExpired: false,
      proExpiry: expiry,
      easterClaimed: false,
      welcomeReward: 15
    }
    if (existUser.length > 0) {
      await updateUsers(usersColl, existUser, newUserData)
    } else {
      await usersColl.add({ data: Object.assign({ _openid: newUserId }, newUserData) })
    }

    await refsColl.add({
      data: {
        referrerId: referrerId,
        newUserId: newUserId,
        time: new Date().toISOString()
      }
    })

    return { code: 0, expiry: expiry }
  } catch (e) {
    console.log('processReferral error:', e)
    return { code: -1, msg: '系统错误' }
  }
}

function today() {
  return formatDate(new Date())
}

function formatDate(d) {
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
}

function p2(n) {
  return (n < 10 ? '0' : '') + n
}

function addDays(ds, n) {
  var d = new Date(ds)
  d.setDate(d.getDate() + n)
  return formatDate(d)
}

function uniqueDocs(a, b) {
  var map = {}
  var list = []
  ;(a || []).concat(b || []).forEach(function (item) {
    if (!item || !item._id || map[item._id]) return
    map[item._id] = true
    list.push(item)
  })
  return list
}

async function getUsers(usersColl, openid) {
  const res = await usersColl.where({ openid: openid }).get()
  const ownRes = await usersColl.where({ _openid: openid }).get().catch(function () { return { data: [] } })
  return uniqueDocs(res.data || [], ownRes.data || [])
}

async function hasUserActivity(openid) {
  const students = await getOwnedDocs('students', openid)
  if (students.length > 0) return true
  const schedules = await getOwnedDocs('schedules', openid)
  return schedules.length > 0
}

async function getOwnedDocs(collName, openid) {
  const coll = db.collection(collName)
  const byOpenid = await coll.where({ openid: openid }).limit(1).get().catch(function () { return { data: [] } })
  if (byOpenid.data && byOpenid.data.length) return byOpenid.data
  const byOwner = await coll.where({ _openid: openid }).limit(1).get().catch(function () { return { data: [] } })
  return byOwner.data || []
}

function hasMemberState(records) {
  records = records || []
  for (var i = 0; i < records.length; i++) {
    var d = records[i] || {}
    if (d.isProMember || d.memberExpired || d.proExpiry || d.welcomeReward || d.pendingReward || d.easterClaimed || d.easterProExpiry) {
      return true
    }
  }
  return false
}

function mergeMemberState(records, openid) {
  var merged = { openid: openid, isProMember: false, memberExpired: false, proExpiry: '', upgradeShown: false }
  var hasLifetime = false
  var maxExpiry = ''
  var hasExpired = false
  var t = today()
  for (var i = 0; i < (records || []).length; i++) {
    var d = records[i] || {}
    var exp = d.proExpiry || d.easterProExpiry || ''
    if (d.upgradeShown) merged.upgradeShown = true
    if (d.isProMember && !d.memberExpired && !exp) {
      hasLifetime = true
    } else if (d.isProMember && !d.memberExpired && exp && exp > t) {
      if (!maxExpiry || exp > maxExpiry) maxExpiry = exp
    } else if (d.memberExpired || (exp && exp <= t)) {
      hasExpired = true
    }
  }
  if (hasLifetime) {
    merged.isProMember = true
    merged.memberExpired = false
    merged.proExpiry = ''
  } else if (maxExpiry) {
    merged.isProMember = true
    merged.memberExpired = false
    merged.proExpiry = maxExpiry
  } else if (hasExpired) {
    merged.memberExpired = true
  }
  return merged
}

async function updateUsers(usersColl, users, data) {
  await Promise.all((users || []).map(function (user) {
    return usersColl.doc(user._id).update({ data: data })
  }))
}
