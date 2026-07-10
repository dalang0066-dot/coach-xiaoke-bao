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

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (e) {
    // Existing collections throw here; ignore and let the real DB operation report other errors.
  }
}

function makeOutTradeNo(plan) {
  const planCode = plan === 'lifetime' ? 'l' : 'm'
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return ('cxb' + planCode + ts + rand).slice(0, 32)
}

function byteLength(text) {
  return Buffer.byteLength(String(text || ''), 'utf8')
}

async function getUsers(openid) {
  await ensureCollection('users')
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

  await ensureCollection('payOrders')
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
  const requestedPlan = event && event.plan
  const plan = requestedPlan === 'lifetime' ? 'lifetime' : (requestedPlan === 'monthly' || !requestedPlan ? 'monthly' : '')
  const totalFee = plan === 'lifetime' ? 6800 : 290
  const body = plan === 'lifetime' ? '教练消课宝永久版' : '教练消课宝专业版月会员'
  const outTradeNo = makeOutTradeNo(plan)
  let orderDocId = ''

  try {
    if (!plan) {
      return { code: -1, errMsg: 'invalid plan' }
    }
    if (!openid) {
      return { code: -1, errMsg: 'missing openid' }
    }
    if (!Number.isInteger(totalFee) || totalFee <= 0) {
      return { code: -1, errMsg: 'invalid total fee' }
    }
    if (!outTradeNo || byteLength(outTradeNo) > 32) {
      return { code: -1, errMsg: 'invalid outTradeNo length' }
    }
    if (!body || byteLength(body) > 128) {
      return { code: -1, errMsg: 'invalid body length' }
    }
    await ensureCollection('payOrders')
    await ensureCollection('users')
    const users = await getUsers(openid)
    const user = mergeMemberState(users, null, openid)
    const baseExpiry = user && user.proExpiry && user.proExpiry > today() ? user.proExpiry : today()
    const proExpiry = plan === 'lifetime' ? '' : addMonths(baseExpiry, 1)

    const addRes = await db.collection('payOrders').add({
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
    orderDocId = addRes._id || ''

    const res = await cloud.cloudPay.unifiedOrder({
      body,
      outTradeNo,
      totalFee,
      subMchId: '1112974888',
      envId: 'cloud1-d3g6bbdp839f36607',
      functionName: 'payOrder',
      openid,
      spbillCreateIp: wxContext.CLIENTIP || '127.0.0.1'
    })

    const payment = res.payment || (
      res.timeStamp && res.nonceStr && res.package && res.paySign
        ? {
          timeStamp: res.timeStamp,
          nonceStr: res.nonceStr,
          package: res.package,
          signType: res.signType || 'RSA',
          paySign: res.paySign
        }
        : null
    )

    if (!payment || !payment.timeStamp || !payment.nonceStr || !payment.package || !payment.paySign) {
      const rawText = JSON.stringify(res || {})
      const noPaymentMsg = rawText && rawText !== '{}' ? rawText.slice(0, 500) : (res.errMsg || res.returnMsg || res.resultMsg || res.returnCode || res.resultCode || 'no payment params')
      if (orderDocId) {
        await db.collection('payOrders').doc(orderDocId).update({
          data: {
            status: 'failed',
            errorMsg: String(noPaymentMsg),
            errorRaw: res,
            failedAt: Date.now()
          }
        }).catch(() => {})
      }
      return { code: -1, errMsg: String(noPaymentMsg), payRaw: res, outTradeNo }
    }
    if (orderDocId) {
      await db.collection('payOrders').doc(orderDocId).update({
        data: {
          status: 'created',
          unifiedOrderAt: Date.now()
        }
      }).catch(() => {})
    }
    return { code: 0, payment, plan, proExpiry }
  } catch (err) {
    const errMsg = err && (err.errMsg || err.message || err.errCode) ? (err.errMsg || err.message || err.errCode) : 'payment order failed'
    console.error('payOrder failed:', err)
    if (orderDocId) {
      await db.collection('payOrders').doc(orderDocId).update({
        data: {
          status: 'failed',
          errorMsg: String(errMsg),
          errorRaw: err || null,
          failedAt: Date.now()
        }
      }).catch(() => {})
    }
    return { code: -1, errMsg: String(errMsg), outTradeNo }
  }
}
