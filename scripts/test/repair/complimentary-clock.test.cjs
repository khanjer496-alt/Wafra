'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {ensureKotlinc,compilerEnv}=require('../kotlin-compiler.cjs');
test('the shipping native lease is tied to this receipt, elapsed realtime and boot',async()=>{
  const kotlinc=await ensureKotlinc(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'wafra-grant-clock-'));
  const files={
    'Store.kt':`package expo.modules.notificationreader
object NotificationCaptureStore { fun clear(context:android.content.Context){} }`,
    'Check.kt':`package expo.modules.notificationreader
import android.content.Context
import android.os.SystemClock
import android.provider.Settings
fun main(){ val c=Context(); val id=1800000000000L
check(ComplimentaryClock.remaining(c,id)==0L)
check(!ComplimentaryClock.anchor(c,id,900001))
check(ComplimentaryClock.anchor(c,id,900000))
SystemClock.now+=300000;check(ComplimentaryClock.remaining(c,id)==600000L)
check(ComplimentaryClock.remaining(c,id+1)==0L)
SystemClock.now+=600000;check(ComplimentaryClock.remaining(c,id)==0L)
check(ComplimentaryClock.anchor(c,id,900000))
Settings.Global.value++;check(ComplimentaryClock.remaining(c,id)==0L)
Settings.Global.value=-1;check(!ComplimentaryClock.anchor(c,id,1000))
Settings.Global.value=42;check(ComplimentaryClock.anchor(c,id,1000))
check(ComplimentaryClock.clear(c));check(ComplimentaryClock.remaining(c,id)==0L)
val now=System.currentTimeMillis(); val receipt=now-1000
check(ComplimentaryClock.anchor(c,receipt,899000))
NotificationCapturePolicy.setConfiguration(c,true,0,receipt)
check(NotificationCapturePolicy.isLeaseActiveAt(c,now));check(NotificationCapturePolicy.isEnabled(c))
check(!NotificationCapturePolicy.isLeaseActiveAt(c,receipt-1))
SystemClock.now+=900000
check(!NotificationCapturePolicy.isLeaseActiveAt(c,receipt+1)) // wall rewound into old valid window
check(ComplimentaryClock.anchor(c,receipt,899000))
check(NotificationCapturePolicy.isLeaseActiveAt(c,now))
Settings.Global.value++
check(!NotificationCapturePolicy.isLeaseActiveAt(c,now))
val trialDeadline=now+60000
NotificationCapturePolicy.setConfiguration(c,true,trialDeadline,receipt)
check(NotificationCapturePolicy.isLeaseActiveAt(c,now))
check(!NotificationCapturePolicy.isLeaseActiveAt(c,trialDeadline))
check(ComplimentaryClock.anchor(c,receipt,899000))
NotificationCapturePolicy.setConfiguration(c,false,trialDeadline,receipt)
check(!NotificationCapturePolicy.isEnabled(c));check(NotificationCapturePolicy.isLeaseActiveAt(c,trialDeadline+1))
check(ComplimentaryClock.clear(c));check(!NotificationCapturePolicy.isLeaseActiveAt(c,trialDeadline+1))
check(NotificationCapturePolicy.isLeaseActiveAt(c,now)) // trial stays independently active
NotificationCapturePolicy.setConfiguration(c,true,now+90000000L,receipt)
Settings.Global.value++;check(NotificationCapturePolicy.isLeaseActiveAt(c,now+89999000L)) // purchased lease
NotificationCapturePolicy.setConfiguration(c,false,0);check(!NotificationCapturePolicy.isLeaseActiveAt(c,now))
println("native grant clock verified") }`,
  };
  try {
    for(const [name,body] of Object.entries(files))fs.writeFileSync(path.join(dir,name),body);
    const source=path.resolve(__dirname,'../../../modules/notification-reader/android/src/main/java/expo/modules/notificationreader/ComplimentaryClock.kt');
    const harness = path.resolve(__dirname, '../kotlin-harness/notification-store');
    const platform = ['AndroidContent.kt', 'AndroidClock.kt', 'AndroidSettings.kt'].map(f => path.join(harness, f));
    execFileSync(kotlinc,[...platform,source,path.join(path.dirname(source),'NotificationCapturePolicy.kt'),...Object.keys(files),'-include-runtime','-d','check.jar'],{cwd:dir,env:compilerEnv(),stdio:'pipe',timeout:60000});
    assert.match(execFileSync(process.env.JAVA||'java',['-jar','check.jar'],{cwd:dir,encoding:'utf8'}),/native grant clock verified/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
