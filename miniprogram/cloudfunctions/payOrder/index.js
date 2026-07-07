const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function p2(n) { return (n < 10 ? '0' : '') + n }
function today() {
  const d = new Date()
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
}
function addMonths(ds, m) {
  const d = new Date(ds)
  d.setMonth(d.getMonth() + m)
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
}

function uniqueDocs(a, b) {
  const map = {}
  const list = []
  ;(a || []).concat(b || []).forEach(item => {
    if (!item || !item._id || map[item._id]) return
    map[item._id] = true
    list.push(item)
  })
  return list
}

async function getUsers(openid) {
  const res = await db.collection('users').where({ openid }).get()
  const ownRes = await db.collection('users').where({ _openid: openid }).get().catch(() => ({ data: [] }))
  return uniqueDocs(res.data || [], ownRes.data || [])
}

function mergeMemberState(records, incoming, openid) {
  const list = (records || []).slice()
  if (incoming) list.push(incoming)
  const merged = {
    openid,
    isProMember: false,
    memberExpired: false,
    proExpiry: '',
    upgradeShown: false
  }
  let hasLifetime = false
  let maxExpiry = ''
  let hasExpired = false
  const todayStr = today()
  list.forEach(d => {
    if (!d) return
    const exp = d.proExpiry || d.easterProExpiry || ''
    if (d.upgradeShown) merged.upgradeShown = true
    if (d.isProMember && !d.memberExpired && !exp) {
      hasLifetime = true
    } else if (d.isProMember && !d.memberExpired && exp && exp > todayStr) {
      if (!maxExpiry || exp > maxExpiry) maxExpiry = exp
    } else if (d.memberExpired || (exp && exp <= todayStr)) {
      hasExpired = true
    }
  })
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

async function saveMember(openid, proExpiry) {
  const users = await getUsers(openid)
  const merged = mergeMemberState(users, { openid, isProMember: true, memberExpired: false, proExpiry: proExpiry || '', upgradeShown: true }, openid)
  const data = { openid, isProMember: merged.isProMember, memberExpired: merged.memberExpired, proExpiry: merged.proExpiry || '', upgradeShown: true }
  if (users.length) {
    await Promise.all(users.map(user => db.collection('users').doc(user._id).update({ data })))
  } else {
    await db.collection('users').add({ data: Object.assign({ _openid: openid }, data) })
  }
}

async function handlePayCallback(event) {
  const outTradeNo = event.outTradeNo || event.out_trade_no || ''
  if (!outTradeNo) return { errcode: 0, errmsg: 'ok' }

  const orderRes = await db.collection('payOrders').where({ outTradeNo }).get()
  if (!orderRes.data || !orderRes.data.length) return { errcode: 0, errmsg: 'ok' }

  const order = orderRes.data[0]
  if (order.status === 'paid') return { errcode: 0, errmsg: 'ok' }

  const ok = (!event.returnCode || event.returnCode === 'SUCCESS') && (!event.resultCode || event.resultCode === 'SUCCESS')
  await db.collection('payOrders').doc(order._id).update({
    data: {
      status: ok ? 'paid' : 'failed',
      transactionId: event.transactionId || event.transaction_id || '',
      paidAt: Date.now(),
      callbackRaw: event
    }
  })

  if (ok && order.openid) {
    await saveMember(order.openid, order.proExpiry || '')
  }
  return { errcode: 0, errmsg: 'ok' }
}

exports.main = async (event, context) => {
  if (event && (event.returnCode || event.resultCode || event.transactionId || event.outTradeNo || event.out_trade_no) && !event.plan) {
    return handlePayCallback(event)
  }

  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const plan = event && event.plan === 'lifetime' ? 'lifetime' : 'monthly'
  const totalFee = plan === 'lifetime' ? 6800 : 290
  const body = plan === 'lifetime' ? '教练消课宝·永久版' : '教练消课宝·专业版月会员'
  const outTradeNo = 'order_' + plan + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)

  try {
    const users = await getUsers(openid)
    const user = mergeMemberState(users, null, openid)
    const baseExpiry = user && user.proExpiry && user.proExpiry > today() ? user.proExpiry : today()
    const proExpiry = plan === 'lifetime' ? '' : addMonths(baseExpiry, 1)

    await db.collection('payOrders').add({
      data: {
        outTradeNo,
        openid,
        plan,
        totalFee,
        proExpiry,
        status: 'pending',
        createdAt: Date.now()
      }
    })

    const res = await cloud.cloudPay.unifiedOrder({
      body,
      outTradeNo,
      totalFee,
      subMchId: '1112974888',
      envId: 'cloud1-d3g6bbdp839f36607',
      functionName: 'payOrder',
      spbillCreateIp: wxContext.CLIENTIP || '127.0.0.1'
    })

    if (!res.payment) {
      return { code: -1, errMsg: '缺少支付参数' }
    }
    return { code: 0, payment: res.payment, plan, proExpiry }
  } catch (err) {
    return { code: -1, errMsg: err.errMsg || err.message || '支付下单失败' }
  }
}
