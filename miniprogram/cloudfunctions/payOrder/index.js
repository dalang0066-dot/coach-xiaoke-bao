const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const totalFee = 2990 // 29.9元永久版

  try {
    const res = await cloud.cloudPay.unifiedOrder({
      body: '教练消课宝·终身版',
      outTradeNo: 'order_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      totalFee: totalFee,
      subMchId: '1112974888',
      envId: 'cloud1-d3g6bbdp839f36607',
      functionName: 'payOrder',
      spbillCreateIp: wxContext.CLIENTIP || '127.0.0.1'
    })

    if (!res.payment) {
      return { code: -1, errMsg: '缺少支付参数' }
    }
    return { code: 0, payment: res.payment }
  } catch (err) {
    return { code: -1, errMsg: err.errMsg || err.message || '支付下单失败' }
  }
}
