package expo.modules.wafraplaybilling;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.QueryPurchasesParams;

/** Owns no purchase actions. The unsolicited purchase listener deliberately does nothing. */
public final class AndroidSubscriptionClient implements SubscriptionQuery.Client {
  private final BillingClient client;

  public AndroidSubscriptionClient(Context context) {
    client = BillingClient.newBuilder(context.getApplicationContext())
        .setListener((result, purchases) -> { /* observed only by the existing purchase owner */ })
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build();
  }

  public void connect(SubscriptionQuery.Connection callback) {
    client.startConnection(new BillingClientStateListener() {
      public void onBillingSetupFinished(BillingResult result) {
        callback.setup(result == null ? null : result.getResponseCode());
      }
      public void onBillingServiceDisconnected() { callback.disconnected(); }
    });
  }

  public void query(SubscriptionQuery.Completion callback) {
    client.queryPurchasesAsync(QueryPurchasesParams.newBuilder()
        .setProductType(BillingClient.ProductType.SUBS).build(), (result, purchases) ->
        callback.complete(PurchaseProjection.project(result == null ? null : result.getResponseCode(), purchases)));
  }

  public void close() { client.endConnection(); }

  public static final class MainScheduler implements SubscriptionQuery.Scheduler {
    private final Handler handler = new Handler(Looper.getMainLooper());
    public void execute(Runnable task) {
      if (Looper.myLooper() == handler.getLooper()) task.run();
      else handler.post(task);
    }
    public Runnable after(long delayMillis, Runnable task) {
      handler.postDelayed(task, delayMillis);
      return () -> handler.removeCallbacks(task);
    }
  }
}
