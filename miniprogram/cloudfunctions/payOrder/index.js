const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { plan } = event
  const wxContext = cloud.getWXContext()

  const prices = {
    monthly: { total: 1880, name: '教练消课宝·月卡会员' },
    yearly: { total: 12880, name: '教练消课宝·年卡会员' }
  }
  const p = prices[plan] || prices.monthly

  try {
    const res = await cloud.cloudPay.unifiedOrder({
      body: p.name,
      outTradeNo: 'order_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      totalFee: p.total,
      subMchId: '1112974888',
      envId: 'cloud1-d3g6bbdp839f36607',
      functionName: 'payOrder',
      spbillCreateIp: wxContext.CLIENTIP || '127.0.0.1'
    })

    console.log('统一下单完整返回:', JSON.stringify(res))
    if (!res.payment) {
      return { code: -1, errMsg: JSON.stringify(res) }
    }
    return { code: 0, payment: res.payment }
  } catch (err) {
    console.log('支付异常:', err)
    return { code: -1, errMsg: err.errMsg || err.message || '支付下单失败' }
  }
}
