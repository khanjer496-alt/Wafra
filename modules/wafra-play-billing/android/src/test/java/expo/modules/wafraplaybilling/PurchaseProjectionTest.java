package expo.modules.wafraplaybilling;

import com.android.billingclient.api.Purchase;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import org.json.JSONException;

public class PurchaseProjectionTest {
  private Purchase purchase(String json) throws JSONException { return new Purchase(json, "synthetic-signature"); }
  private Purchase row(String id, int state) throws JSONException {
    return purchase("{\"productId\":\""+id+"\",\"purchaseState\":"+state+
        ",\"orderId\":\"synthetic-private-order\",\"purchaseToken\":\"synthetic-private-token\"}");
  }
  private SubscriptionResult project(Purchase... rows) { return PurchaseProjection.project(0,Arrays.asList(rows)); }
  @Test public void realBillingObjectPurchasedStateIsProjected() throws Exception {
    Purchase p=row("wafra_pro_weekly",0); assertEquals(Purchase.PurchaseState.PURCHASED,p.getPurchaseState());
    SubscriptionResult r=project(p); assertEquals("active",r.status);
    assertEquals(Collections.singletonList("wafra_pro_weekly"),r.activeProductIds);
    assertEquals(Integer.valueOf(0),r.responseCode);
  }
  /** The exact bridge map superwall-attribute-loop.test.cjs feeds the real provider, per plan. */
  @Test public void eachPlanPurchaseCrossesTheBridgeAsItsBareSkuOnly() throws Exception {
    for(String sku:Arrays.asList("wafra_pro_weekly","wafra_pro_yearly")) {
      java.util.Map<String,Object> map=project(row(sku,0)).toMap();
      assertEquals(Arrays.asList("status","activeProductIds","pendingProductIds","responseCode"),new java.util.ArrayList<>(map.keySet()));
      assertEquals("active",map.get("status"));
      assertEquals(Collections.singletonList(sku),map.get("activeProductIds"));
      assertEquals(Collections.emptyList(),map.get("pendingProductIds"));
      assertEquals(Integer.valueOf(0),map.get("responseCode"));
    }
  }
  @Test public void retiredMonthlyRemainsARecognizedOwnedSubscription() throws Exception {
    assertEquals(Collections.singletonList("wafra_pro_monthly"),project(row("wafra_pro_monthly",0)).activeProductIds);
  }
  @Test public void pendingOnlyCannotUnlockButIsReported() throws Exception {
    Purchase p=row("wafra_pro_yearly",4); assertEquals(Purchase.PurchaseState.PENDING,p.getPurchaseState());
    SubscriptionResult r=project(p); assertEquals("inactive",r.status); assertTrue(r.activeProductIds.isEmpty());
    assertEquals(Collections.singletonList("wafra_pro_yearly"),r.pendingProductIds);
  }
  @Test public void mixedPurchasedAndPendingAreKeptSeparate() throws Exception {
    SubscriptionResult r=project(row("wafra_pro_weekly",0),row("wafra_pro_yearly",4));
    assertEquals("active",r.status); assertEquals(1,r.activeProductIds.size()); assertEquals(1,r.pendingProductIds.size());
  }
  @Test public void successfulEmptyIsTheOnlyEmptyQueryProof() {
    assertEquals("inactive",PurchaseProjection.project(0,Collections.emptyList()).status);
    assertEquals("unknown",PurchaseProjection.project(0,null).status);
  }
  @Test public void failedQueryCannotReturnEvenIncludedPositiveRows() throws Exception {
    List<Purchase> rows=Collections.singletonList(row("wafra_pro_weekly",0));
    for(Integer code:Arrays.asList(null,-1,1,2,3,4,5,6,7,8,12)) {
      SubscriptionResult r=PurchaseProjection.project(code,rows); assertEquals("unknown",r.status);
      assertEquals(code,r.responseCode); assertTrue(r.activeProductIds.isEmpty());
    }
  }
  @Test public void onlyExactBareSkuMatches() throws Exception {
    assertEquals("inactive",project(row("wafra_pro_weekly:weekly:sw-auto",0),row("other_subscription",0),row("WAFRA_PRO_YEARLY",0)).status);
  }
  @Test public void repeatedIdsAndMultiProductRecordsAreDeduplicated() throws Exception {
    SubscriptionResult r=project(purchase("{\"productIds\":[\"wafra_pro_yearly\",\"wafra_pro_weekly\"],\"purchaseState\":0}"),row("wafra_pro_weekly",0));
    assertEquals(Arrays.asList("wafra_pro_weekly","wafra_pro_yearly"),r.activeProductIds);
  }
  @Test public void unknownRawStateDoesNotUseBillingGetterDefault() throws Exception {
    for(String state:Arrays.asList("1","2","3","5","-1","\"0\"","null","0.5")) {
      assertEquals("unknown",project(purchase("{\"productId\":\"wafra_pro_weekly\",\"purchaseState\":"+state+"}")).status);
    }
  }
  @Test public void missingStateIsUnknown() throws Exception {
    assertEquals("unknown",project(purchase("{\"productId\":\"wafra_pro_weekly\"}")).status);
  }
  @Test public void malformedProductsAreUnknownEvenBesidePositiveRecord() throws Exception {
    for(String products:Arrays.asList("", "\"productId\":null,", "\"productId\":23,", "\"productId\":\"\",",
        "\"productIds\":null,", "\"productIds\":[],", "\"productIds\":[1],", "\"productIds\":[null],", "\"productIds\":[\" \"],")) {
      assertEquals("unknown",project(row("wafra_pro_weekly",0),purchase("{"+products+"\"purchaseState\":0}")).status);
    }
  }
  @Test public void nullPurchaseMakesWholeAnswerUnknown() throws Exception {
    assertEquals("unknown",project(row("wafra_pro_weekly",0),null).status);
  }
  @Test public void returnedMapContainsOnlyFourSafeFields() throws Exception {
    SubscriptionResult r=project(row("wafra_pro_weekly",0));
    assertEquals(new HashSet<>(Arrays.asList("status","activeProductIds","pendingProductIds","responseCode")),r.toMap().keySet());
    assertFalse(r.toMap().toString().contains("synthetic-private")); assertFalse(r.toMap().toString().contains("signature"));
  }
  @Test public void exportedListsCannotMutateTheStoredResult() throws Exception {
    SubscriptionResult r=project(row("wafra_pro_weekly",0));
    ((List<?>)r.toMap().get("activeProductIds")).clear();
    assertEquals(1,r.activeProductIds.size());
  }
}
