var app = getApp()
Page({
  data:{sbh:20,studentId:0,studentName:'',remaining:0,emoji:'🐯',records:[]},
  onLoad:function(o){
    try{
      var sys=wx.getSystemInfoSync(),id=parseInt(o.id)||0
      this.setData({sbh:sys.statusBarHeight,studentId:id,studentName:decodeURIComponent(o.name||''),remaining:parseInt(o.remaining)||0,emoji:decodeURIComponent(o.emoji||'🐯')})
    }catch(e){}
    this.load()
  },
  load:function(){
    try{
      var ss=(app&&app.globalData&&app.globalData.students)?app.globalData.students:[],recs=[]
      for(var i=0;i<ss.length;i++){if(ss[i].id===this.data.studentId&&ss[i].history){recs=ss[i].history.slice().sort(function(a,b){return(b.ts||0)-(a.ts||0)});break}}
      this.setData({records:recs})
    }catch(e){}
  },
  goBack:function(){wx.navigateBack({delta:1})}
})