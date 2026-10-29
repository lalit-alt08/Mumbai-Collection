import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import service, { _setWpClientForTesting } from '../src/services/paymentIntentService.js';
import { finalizePaymentAndCreateOrder, cancelPaymentOrder, handleWebhook } from '../src/controllers/paymentController.js';
import { runPaymentReconciliation } from '../src/services/reconciliationService.js';
import { refundRazorpayPayment, _setRazorpayInstanceForTesting } from '../src/services/razorpayService.js';
import { _setAnomalyHandlerForTesting } from '../src/services/alertService.js';
import storeHours from '../src/services/storeHoursService.js';
import api from '../src/config/woocommerce.js';
import { serverCache } from '../src/utils/memoryCache.js';

test('Payment lifecycle recovery regressions (mock gateways; no money or HTTP server)', async t => {
  const originals = { ...service };
  const oldPut = api.put, oldPost = api.post, oldHours = storeHours.getStoreStatus;
  let intent, order, creations, refunds, released, gateway, batches, locks;
  const response = () => ({ statusCode: 200, body: null, status(n) { this.statusCode=n; return this; }, json(body) { this.body=body; return this; } });
  t.beforeEach(() => {
    serverCache.clear();
    intent = { customer_id: 7, status: 'created', amount_in_paise: 54000, created_at: Date.now(),
      stock_reservation_id: 'stock-token-123', checkout_payload: { customer_id: 7, line_items: [{ product_id: 9, quantity: 2 }] } };
    order=null; creations=0; refunds=0; released=0; batches=[]; locks=new Map();
    service.acquireLock=async (key, owner) => { if (locks.has(key) && locks.get(key)!==owner) return false; locks.set(key,owner); return true; };
    service.releaseLock=async (key,owner) => { if (locks.get(key)===owner) locks.delete(key); return true; };
    service.getPaymentIntent=async () => ({ ...intent });
    service.findWcOrderByRazorpayOrderId=async () => order;
    service.reserveCheckoutStock=async () => ({ success:true });
    service.releaseCheckoutStock=async () => { released++; return true; };
    service.clearCustomerWcCart=async () => true;
    service.updatePaymentIntentStatus=async p => {
      if (p.fromStatus && p.fromStatus!==intent.status) return false;
      if (p.toStatus==='paid' && !intent.first_paid_at) intent.first_paid_at=new Date().toISOString().slice(0,19).replace('T',' ');
      intent.status=p.toStatus;
      if (p.rzpPaymentId) intent.rzp_payment_id=p.rzpPaymentId;
      if (p.incrementAttempts) intent.attempts=(intent.attempts||0)+1;
      if (p.errorReason) intent.error_reason=p.errorReason;
      return true;
    };
    service.createPaidOrder=async () => { creations++; order={ id:88, customer_id:7, total:'540.00', status:'processing' }; return { data:order }; };
    service.fetchReconciliationList=async p => { batches.push(p); return { intents:[{ rzp_order_id:'order_lifecycle', status:intent.status }], hasMore:false }; };
    gateway={ payments: {
      fetch:async () => ({ id:'pay_lifecycle', order_id:'order_lifecycle', status:'captured', amount:54000, currency:'INR', amount_refunded:0 }),
      fetchMultipleRefund:async () => ({ items:[] }),
      refund:async () => { refunds++; return { id:'refund_lifecycle', amount:54000, status:'pending' }; },
    }, orders:{ fetch:async () => ({ status:'created',amount_paid:0 }), fetchPayments:async () => ({ items:[{ id:'pay_lifecycle',status:'captured' }] }) } };
    _setRazorpayInstanceForTesting(gateway);
    _setWpClientForTesting({ post:async () => ({ data:{ success:true,updated:true } }) });
    _setAnomalyHandlerForTesting(async () => {});
    storeHours.getStoreStatus=async () => ({ is_open:true });
    api.put=async () => ({ data:{} }); api.post=async () => ({ data:{} });
    process.env.RAZORPAY_WEBHOOK_SECRET='test_webhook_secret';
  });
  t.after(() => {
    Object.assign(service,originals); api.put=oldPut; api.post=oldPost; storeHours.getStoreStatus=oldHours;
    _setRazorpayInstanceForTesting(null); _setWpClientForTesting(null); _setAnomalyHandlerForTesting(null);
  });
  const finalize = () => finalizePaymentAndCreateOrder({ rzpOrderId:'order_lifecycle',rzpPaymentId:'pay_lifecycle',expectedCustomerId:7 });
  const sendEvent = async body => {
    const raw=JSON.stringify(body), res=response();
    await handleWebhook({ body,rawBody:raw,headers:{ 'x-razorpay-signature':crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex'), 'x-razorpay-event-id':crypto.randomUUID() } },res);
    await new Promise(resolve=>setTimeout(resolve,25));
    return res;
  };
  await t.test('refund recovery blocks fulfillment even when stock is available',async () => {
    for (const status of ['refund_pending','refund_failed','refund_escalated']) {
      intent.status=status;
      const result=await finalize();
      assert.equal(result.terminal,true); assert.equal(creations,0); assert.equal(refunds,0);
    }
  });
  await t.test('reconciler uses the shared financial-total guard',async () => {
    service.createPaidOrder=async () => { creations++; return { data:{ id:88,total:'600.00' } }; };
    await runPaymentReconciliation({ olderThanMinutes:0 });
    assert.equal(creations,1); assert.equal(intent.status,'amount_mismatch');
  });
  await t.test('webhook failure preserves paid recovery instead of orphaning it',async () => {
    service.createPaidOrder=async () => { throw new Error('WooCommerce temporarily down'); };
    await sendEvent({ event:'payment.captured',payload:{ payment:{ entity:{ id:'pay_lifecycle',order_id:'order_lifecycle' } } } });
    assert.equal(intent.status,'paid');
  });
  await t.test('pagination follows stable cursors without offset or watermark',async () => {
    service.fetchReconciliationList=async p => {
      batches.push(p);
      return { intents:[{ rzp_order_id:p.cursor ? 'order_b' : 'order_a',status:'created' }],hasMore:!p.cursor,nextCursor:'order_a' };
    };
    gateway.orders.fetchPayments=async () => ({ items:[] });
    const result=await runPaymentReconciliation();
    assert.equal(result.processed,2); assert.equal(batches[1].cursor,'order_a'); assert.equal(batches[1].page,undefined);
  });
  await t.test('a gateway pending refund is observed without submitting another refund',async () => {
    gateway.payments.fetchMultipleRefund=async () => ({ items:[{ id:'refund_existing',status:'pending',amount:54000 }] });
    const result=await refundRazorpayPayment({ paymentId:'pay_lifecycle',amountInPaise:54000 });
    assert.equal(result.existing_pending,true); assert.equal(refunds,0);
  });
  await t.test('intentional partial refund does not enroll the remaining balance for refund',async () => {
    intent.status='order_created';
    gateway.payments.fetch=async () => ({ id:'pay_lifecycle',order_id:'order_lifecycle',amount:54000,amount_refunded:1000,refund_status:'partial' });
    await sendEvent({ event:'refund.processed',payload:{ refund:{ entity:{ id:'refund_partial',payment_id:'pay_lifecycle' } } } });
    assert.equal(intent.status,'order_created'); assert.equal(refunds,0);
  });
  await t.test('gateway outage during cancellation retains stock and recoverable state',async () => {
    gateway.orders.fetch=async () => { throw new Error('gateway unavailable'); };
    const res=response();
    await cancelPaymentOrder({ body:{ razorpay_order_id:'order_lifecycle' },user:{ id:7 } },res);
    assert.equal(res.statusCode,503); assert.equal(intent.status,'created'); assert.equal(released,0);
  });
  await t.test('late capture after cancellation is finalized by reconciliation',async () => {
    intent.status='cancelled';
    await runPaymentReconciliation({ olderThanMinutes:0 });
    assert.equal(creations,1); assert.equal(intent.status,'order_created');
  });
  await t.test('a retry deadline does not reset when updated_at changes',async () => {
    intent.status='paid'; intent.rzp_payment_id='pay_lifecycle';
    intent.first_paid_at=new Date(Date.now()-20*60000).toISOString().slice(0,19).replace('T',' ');
    intent.updated_at=new Date().toISOString();
    const result=await finalize();
    assert.equal(creations,0); assert.equal(refunds,1); assert.equal(result.refunded,false); assert.equal(intent.status,'refund_pending');
  });
  await t.test('a first recovered capture gets an order attempt even if gateway payment is older',async () => {
    gateway.payments.fetch=async () => ({ id:'pay_lifecycle',order_id:'order_lifecycle',status:'captured',amount:54000,currency:'INR',created_at:Math.floor(Date.now()/1000)-3600 });
    await runPaymentReconciliation({ olderThanMinutes:0 });
    assert.equal(creations,1); assert.equal(refunds,0);
  });
  await t.test('failed durable paid transition prevents WooCommerce creation',async () => {
    service.updatePaymentIntentStatus=async () => false;
    const result=await finalize();
    assert.equal(result.status,503); assert.equal(creations,0);
  });
  await t.test('browser and reconciler competing for one payment create only one order',async () => {
    let entered, finish;
    const started=new Promise(resolve=>{ entered=resolve; });
    const gate=new Promise(resolve=>{ finish=resolve; });
    service.createPaidOrder=async () => {
      entered(); await gate; creations++;
      order={ id:88,total:'540.00',customer_id:7,status:'processing' };
      return { data:order };
    };
    const browser=finalize();
    await started;
    const concurrent=await finalizePaymentAndCreateOrder({ rzpOrderId:'order_lifecycle',rzpPaymentId:'pay_lifecycle',source:'reconciler' });
    assert.equal(concurrent.status,409);
    finish(); await browser;
    assert.equal(creations,1);
  });
  await t.test('uncertain WooCommerce lookup never permits a duplicate creation',async () => {
    service.findWcOrderByRazorpayOrderId=async () => { throw new Error('lookup unavailable'); };
    await assert.rejects(finalize(),/lookup unavailable/);
    assert.equal(creations,0); assert.equal(locks.size,0);
  });
  await t.test('finalization bypasses stale process memory for payment state',async () => {
    service.getPaymentIntent=async (_id, options) => {
      assert.equal(options?.fresh,true);
      return { ...intent,status:'refund_pending' };
    };
    assert.equal((await finalize()).terminal,true);
    assert.equal(creations,0);
  });
  await t.test('a partial manual refund before order creation requires review',async () => {
    gateway.payments.fetch=async () => ({ id:'pay_lifecycle',order_id:'order_lifecycle',status:'captured',amount:54000,currency:'INR',amount_refunded:1000,refund_status:'partial' });
    await finalize();
    assert.equal(intent.status,'refund_escalated'); assert.equal(creations,0); assert.equal(refunds,0);
  });
  await t.test('invalid gateway payment lookups count toward the refund retry limit',async () => {
    intent.status='refund_pending'; intent.rzp_payment_id='pay_lifecycle';
    gateway.payments.fetch=async () => { throw { statusCode:400,error:{ code:'BAD_REQUEST_ERROR',description:'The id provided does not exist' } }; };
    for (let attempt=1;attempt<=3;attempt++) {
      const result=await runPaymentReconciliation();
      assert.equal(result.errorCount,1);
      assert.match(result.errors[0].error,/id provided does not exist/);
      assert.equal(result.errors[0].status,400);
      assert.equal(intent.attempts,attempt);
    }
    assert.equal(intent.status,'refund_escalated');
    assert.equal(refunds,0); assert.equal(creations,0);
  });
  await t.test('an already exhausted refund is escalated before another gateway request',async () => {
    intent.status='refund_failed'; intent.attempts=36;
    let lookups=0;
    gateway.payments.fetch=async () => { lookups++; throw new Error('Gateway unavailable'); };
    const result=await runPaymentReconciliation();
    assert.equal(intent.status,'refund_escalated');
    assert.equal(result.escalated,1); assert.equal(lookups,0); assert.equal(refunds,0);
  });
  await t.test('failed payment discovery pauses for review without initiating refunds',async () => {
    gateway.orders.fetchPayments=async () => { throw { statusCode:404,error:{ code:'BAD_REQUEST_ERROR',description:'Order not found' } }; };
    for (let attempt=0;attempt<3;attempt++) await runPaymentReconciliation();
    assert.equal(intent.status,'reconciliation_escalated');
    assert.equal(intent.attempts,3); assert.equal(refunds,0); assert.equal(creations,0);
    const result=await finalize();
    assert.equal(result.terminal,true); assert.equal(result.support_required,true);
    const res=response();
    await cancelPaymentOrder({ body:{ razorpay_order_id:'order_lifecycle' },user:{ id:7 } },res);
    assert.equal(res.statusCode,409); assert.equal(released,0);
  });
  await t.test('a failed escalation write does not falsely report an escalated payment',async () => {
    intent.status='refund_failed'; intent.attempts=36;
    service.updatePaymentIntentStatus=async () => false;
    const result=await runPaymentReconciliation();
    assert.equal(intent.status,'refund_failed'); assert.equal(result.escalated,0);
    assert.equal(result.errorCount,1); assert.equal(refunds,0);
  });
  await t.test('previous WooCommerce failures do not consume the gateway lookup limit',async () => {
    intent.status='paid'; intent.attempts=10; intent.error_reason='WooCommerce temporarily unavailable';
    intent.first_paid_at=new Date().toISOString().slice(0,19).replace('T',' ');
    await runPaymentReconciliation();
    assert.equal(intent.status,'order_created'); assert.equal(creations,1); assert.equal(refunds,0);
  });
});
