package expo.modules.wafraplaybilling;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.Purchase;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;

final class PurchaseProjection {
  private static final Set<String> ALLOWED = new HashSet<>(Arrays.asList(
      "wafra_pro_weekly", "wafra_pro_yearly", "wafra_pro_monthly"));

  static SubscriptionResult project(Integer code, List<Purchase> purchases) {
    if (code == null || code != BillingClient.BillingResponseCode.OK || purchases == null) {
      return SubscriptionResult.unknown(code);
    }
    Set<String> active = new TreeSet<>();
    Set<String> pending = new TreeSet<>();
    boolean needsAcknowledgement = false;
    try {
      for (Purchase purchase : purchases) {
        if (purchase == null) return SubscriptionResult.unknown(code);
        // Purchase getters supply defaults for missing/unknown JSON values. A default
        // must not turn a malformed record into confirmed purchased access.
        JSONObject json = new JSONObject(purchase.getOriginalJson());
        Object rawState = json.opt("purchaseState");
        if (!(rawState instanceof Integer || rawState instanceof Long)) {
          return SubscriptionResult.unknown(code);
        }
        long raw = ((Number) rawState).longValue();
        if (raw != 0 && raw != 4) return SubscriptionResult.unknown(code);
        int state = purchase.getPurchaseState();
        if ((raw == 0 && state != Purchase.PurchaseState.PURCHASED) ||
            (raw == 4 && state != Purchase.PurchaseState.PENDING)) {
          return SubscriptionResult.unknown(code);
        }
        if (json.has("productIds")) {
          Object ids = json.opt("productIds");
          if (!(ids instanceof JSONArray) || ((JSONArray) ids).length() == 0) {
            return SubscriptionResult.unknown(code);
          }
          for (int index = 0; index < ((JSONArray) ids).length(); index++) {
            Object id = ((JSONArray) ids).opt(index);
            if (!(id instanceof String) || ((String) id).trim().isEmpty()) {
              return SubscriptionResult.unknown(code);
            }
          }
        } else if (!(json.opt("productId") instanceof String)) {
          return SubscriptionResult.unknown(code);
        }
        List<String> products = purchase.getProducts();
        if (products == null || products.isEmpty()) return SubscriptionResult.unknown(code);
        for (String id : products) {
          if (id == null || id.trim().isEmpty()) return SubscriptionResult.unknown(code);
          if (!ALLOWED.contains(id)) continue;
          if (state == Purchase.PurchaseState.PURCHASED) {
            active.add(id);
            if (!purchase.isAcknowledged()) needsAcknowledgement = true;
          }
          else pending.add(id);
        }
      }
      return SubscriptionResult.success(new ArrayList<>(active), new ArrayList<>(pending), needsAcknowledgement);
    } catch (Exception ignored) {
      // A parser/library failure is not evidence of an empty successful query.
      return SubscriptionResult.unknown(code);
    }
  }
}
