package expo.modules.wafraplaybilling;

import com.android.billingclient.api.Purchase;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;
import java.util.function.Consumer;

public class PurchaseAcknowledgementTest {
  private Purchase row(String sku, int state, boolean acknowledged, String token) throws Exception {
    return new Purchase("{\"productId\":\"" + sku + "\",\"purchaseState\":" + state
        + ",\"acknowledged\":" + acknowledged + ",\"purchaseToken\":\"" + token + "\"}", "synthetic");
  }
  private static class Store implements PurchaseAcknowledgement.Store {
    List<String> tokens = new ArrayList<>();
    List<Consumer<Integer>> callbacks = new ArrayList<>();
    boolean open = true;
    List<Integer> failures = new ArrayList<>();
    int recovered;
    public void diagnostic(Integer code) { failures.add(code); }
    public void recovered() { recovered++; }
    public boolean isOpen() { return open; }
    public void acknowledge(String token, Consumer<Integer> done) { tokens.add(token); callbacks.add(done); }
  }
  @Test public void recoveredPurchasedPlanWaitsForSuccessfulAcknowledgement() throws Exception {
    Store store = new Store(); List<SubscriptionResult> results = new ArrayList<>();
    PurchaseAcknowledgement.process(0, Arrays.asList(row("wafra_pro_weekly",0,false,"synthetic-token")),store,results::add);
    assertEquals(Arrays.asList("synthetic-token"),store.tokens); assertTrue(results.isEmpty());
    store.callbacks.get(0).accept(0); assertEquals("active",results.get(0).status);
    assertEquals(1,store.recovered); assertTrue(store.failures.isEmpty());
    assertFalse(results.get(0).toMap().toString().contains("synthetic-token"));
  }
  @Test public void pendingAcknowledgedAndUnrelatedPurchasesAreNeverAcknowledged() throws Exception {
    Store store = new Store(); List<SubscriptionResult> results = new ArrayList<>();
    PurchaseAcknowledgement.process(0,Arrays.asList(row("wafra_pro_weekly",4,false,"pending"),
        row("wafra_pro_yearly",0,true,"already"),row("other",0,false,"other")),store,results::add);
    assertTrue(store.tokens.isEmpty()); assertEquals("active",results.get(0).status);
    assertEquals(Arrays.asList("wafra_pro_weekly"),results.get(0).pendingProductIds);
  }
  @Test public void failedAcknowledgementIsUnknownAndNextQueryRetries() throws Exception {
    Store store = new Store(); List<SubscriptionResult> results = new ArrayList<>();
    List<Purchase> purchases=Arrays.asList(row("wafra_pro_weekly",0,false,"retry"));
    PurchaseAcknowledgement.process(0,purchases,store,results::add); store.callbacks.get(0).accept(2);
    assertEquals("unknown",results.get(0).status); assertEquals(Arrays.asList(2), store.failures);
    PurchaseAcknowledgement.process(0,purchases,store,results::add); store.callbacks.get(1).accept(0);
    assertEquals(Arrays.asList("retry","retry"),store.tokens); assertEquals("active",results.get(1).status);
  }
  @Test public void failedQueryMalformedRowAndMissingTokenHaveNoSideEffects() throws Exception {
    for (int mode=0;mode<3;mode++) {
      Store store=new Store(); List<SubscriptionResult> results=new ArrayList<>();
      PurchaseAcknowledgement.process(mode==0 ? 2 : 0, Arrays.asList(mode==1 ? null :
          row("wafra_pro_weekly",0,false,mode==2 ? "" : "private")),store,results::add);
      assertTrue(store.tokens.isEmpty()); assertEquals("unknown",results.get(0).status);
    }
  }
  @Test public void tokensAreDeduplicatedAndCallbacksAreOneShot() throws Exception {
    Store store=new Store(); List<SubscriptionResult> results=new ArrayList<>();
    Purchase p=row("wafra_pro_weekly",0,false,"same");
    PurchaseAcknowledgement.process(0,Arrays.asList(p,p),store,results::add);
    store.callbacks.get(0).accept(0); store.callbacks.get(0).accept(0);
    assertEquals(1,store.tokens.size()); assertEquals(1,results.size());
  }
  @Test public void timeoutClosePreventsFurtherAcknowledgements() throws Exception {
    Store store=new Store(); List<SubscriptionResult> results=new ArrayList<>();
    PurchaseAcknowledgement.process(0,Arrays.asList(row("wafra_pro_weekly",0,false,"one"),
        row("wafra_pro_yearly",0,false,"two")),store,results::add);
    store.open=false; store.callbacks.get(0).accept(0);
    assertEquals(Arrays.asList("one"),store.tokens); assertTrue(results.isEmpty());
  }
  @Test public void sdkWinningConcurrentAcknowledgementBecomesNoOpOnFreshQuery() throws Exception {
    Store store=new Store(); List<SubscriptionResult> results=new ArrayList<>();
    PurchaseAcknowledgement.process(0,Arrays.asList(row("wafra_pro_weekly",0,false,"race")),store,results::add);
    store.callbacks.get(0).accept(5); // SDK may have won; do not claim success from error.
    assertEquals("unknown",results.get(0).status);
    PurchaseAcknowledgement.process(0,Arrays.asList(row("wafra_pro_weekly",0,true,"race")),store,results::add);
    assertEquals(Arrays.asList("race"),store.tokens); assertEquals("active",results.get(1).status);
  }
  @Test public void synchronousBillingExceptionIsSanitizedAndDoesNotEscape() throws Exception {
    Store store=new Store() {
      public void acknowledge(String token, Consumer<Integer> done) { throw new IllegalStateException("private synthetic message"); }
    };
    List<SubscriptionResult> results=new ArrayList<>();
    PurchaseAcknowledgement.process(0,Arrays.asList(row("wafra_pro_weekly",0,false,"private")),store,results::add);
    assertEquals("unknown",results.get(0).status); assertEquals(1,store.failures.size());
    assertNull(store.failures.get(0)); assertEquals(0,store.recovered);
  }

}
