const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { referrerId } = event
  const wxContext = cloud.getWXContext()
  const newUserId = wxContext.OPENID

  if (!referrerId || !newUserId) return { code: -1, msg: '参数错误' }
  if (referrerId === newUserId) return { code: -1, msg: '不能邀请自己' }

  try {
    const usersColl = db.collection('users')
    const refsColl = db.collection('referrals')

    // 1. 检查被分享者是否已是老用户
    const existUser = await usersColl.where({ openid: newUserId }).get()
    if (existUser.data.length > 0) return { code: -1, msg: '该用户不是新用户' }

    // 2. 检查被分享者是否已被他人邀请过
    const existRef = await refsColl.where({ newUserId: newUserId }).get()
    if (existRef.data.length > 0) return { code: -1, msg: '该用户已被邀请过' }

    // 3. 计算15天后的日期
    var d = new Date(); d.setDate(d.getDate() + 15)
    var expiry = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())

    // 4. 给分享者叠加15天（没有记录则创建）
    const referrer = await usersColl.where({ openid: referrerId }).get()
    if (referrer.data.length > 0) {
      var rd = referrer.data[0]
      var base = rd.proExpiry && rd.proExpiry > today() ? rd.proExpiry : today()
      var newExp = addDays(base, 15)
      await usersColl.doc(rd._id).update({
        data: { isProMember: true, memberExpired: false, proExpiry: newExp, pendingReward: 15 }
      })
    } else {
      await usersColl.add({
        data: {
          openid: referrerId,
          isProMember: true, memberExpired: false, proExpiry: expiry,
          pendingReward: 15, easterClaimed: false
        }
      })
    }

    // 5. 给被分享者创建用户记录（15天试用 + 欢迎标记）
    await usersColl.add({
      data: {
        openid: newUserId,
        isProMember: true, memberExpired: false, proExpiry: expiry,
        easterClaimed: false, welcomeReward: 15
      }
    })

    // 6. 记录推荐关系
    await refsColl.add({
      data: { referrerId: referrerId, newUserId: newUserId, time: new Date().toISOString() }
    })

    return { code: 0 }
  } catch (e) {
    console.log('推荐处理异常:', e)
    return { code: -1, msg: '系统错误' }
  }
}

function today() {
  var d = new Date()
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
}

function p2(n) { return (n < 10 ? '0' : '') + n }

function addDays(ds, n) {
  var d = new Date(ds); d.setDate(d.getDate() + n)
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
}
