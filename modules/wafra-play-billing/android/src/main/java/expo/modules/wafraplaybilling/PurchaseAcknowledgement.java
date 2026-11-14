package expo.modules.wafraplaybilling;

import com.android.billingclient.api.Purchase;
import java.util.List;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/** Query-result processing; tokens never cross the native bridge. */
final class PurchaseAcknowledgement {
  interface Store {
    boolean isOpen();
    void diagnostic(Integer code);
    void recovered();
    void acknowledge(String token, Consumer<Integer> completion);
  }
  static void process(Integer code, List<Purchase> purchases, Store store,
      SubscriptionQuery.Completion completion) {
    SubscriptionResult projected = PurchaseProjection.project(code, purchases);
    if ("unknown".equals(projected.status)) {
      store.diagnostic(code == null || code == 0 ? -2 : code);
      completion.complete(projected);
      return;
    }
    Set<String> tokens = new LinkedHashSet<>();
    try {
      for (Purchase purchase : purchases) {
        // The successful projection validates raw states and product identifiers.
        // Pending payments, unrelated products and already acknowledged purchases
        // never enter the acknowledgement path.
        if (purchase.getPurchaseState() != Purchase.PurchaseState.PURCHASED || purchase.isAcknowledged()) continue;
        boolean pro = false;
        for (String id : purchase.getProducts()) {
          if (projected.activeProductIds.contains(id)) pro = true;
        }
        if (!pro) continue;
        String token = purchase.getPurchaseToken();
        if (token == null || token.trim().isEmpty()) {
          store.diagnostic(null);
          completion.complete(SubscriptionResult.unknown(null));
          return;
        }
        // Play ACK is per token: a multi-product purchase is acknowledged as a whole.
        tokens.add(token);
      }
    } catch (Exception ignored) {
      store.diagnostic(null);
      completion.complete(SubscriptionResult.unknown(null));
      return;
    }
    acknowledgeNext(new ArrayList<>(tokens), 0, store, projected, completion);
  }

  private static void acknowledgeNext(List<String> tokens, int index, Store store,
      SubscriptionResult projected, SubscriptionQuery.Completion completion) {
    if (!store.isOpen()) return; // The query deadline/cancellation already resolves unknown.
    if (index == tokens.size()) {
      completion.complete(projected);
      return;
    }
    AtomicBoolean answered = new AtomicBoolean();
    try {
      store.acknowledge(tokens.get(index), code -> {
        if (!answered.compareAndSet(false, true) || !store.isOpen()) return;
        if (code == null || code != 0) {
          store.diagnostic(code);
          completion.complete(SubscriptionResult.unknown(code));
        } else {
          store.recovered();
          acknowledgeNext(tokens, index + 1, store, projected, completion);
        }
      });
    } catch (Exception ignored) {
      if (answered.compareAndSet(false, true) && store.isOpen()) {
        store.diagnostic(null);
        completion.complete(SubscriptionResult.unknown(null));
      }
    }
  }
}
