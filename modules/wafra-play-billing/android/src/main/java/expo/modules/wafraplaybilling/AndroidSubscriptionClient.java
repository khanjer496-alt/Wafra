package expo.modules.wafraplaybilling;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.QueryPurchasesParams;

/** Queries ownership and recovers unfinished Pro acknowledgements; never launches checkout. */
public final class AndroidSubscriptionClient implements SubscriptionQuery.Client {
  private final BillingClient client;
  private volatile boolean closed;
  private final boolean recoverAcknowledgements;

  public AndroidSubscriptionClient(Context context) { this(context, false); }

  public AndroidSubscriptionClient(Context context, boolean recoverAcknowledgements) {
    this.recoverAcknowledgements = recoverAcknowledgements;
    client = BillingClient.newBuilder(context.getApplicationContext())
        .setListener((result, purchases) -> { /* observed only by the existing purchase owner */ })
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build();
  }

  public void connect(SubscriptionQuery.Connection callback) {
    client.startConnection(new BillingClientStateListener() {
      public void onBillingSetupFinished(BillingResult result) {
        Integer code = result == null ? null : result.getResponseCode();
        if (recoverAcknowledgements && (code == null || code != 0)) diagnostic(code);
        callback.setup(code);
      }
      public void onBillingServiceDisconnected() {
        if (recoverAcknowledgements) diagnostic(-1);
        callback.disconnected();
      }
    });
  }

  public void query(SubscriptionQuery.Completion callback) {
    client.queryPurchasesAsync(QueryPurchasesParams.newBuilder()
        .setProductType(BillingClient.ProductType.SUBS).build(), (result, purchases) -> {
          Integer code = result == null ? null : result.getResponseCode();
          if (!recoverAcknowledgements) {
            callback.complete(PurchaseProjection.project(code, purchases));
            return;
          }
          // This entry point is invoked only after the provider durably grants Pro.
          // Every retry queries again, so concurrent Superwall ACK is a no-op.
          PurchaseAcknowledgement.process(code, purchases,
              new PurchaseAcknowledgement.Store() {
                public boolean isOpen() { return !closed; }
                public void diagnostic(Integer failure) { AndroidSubscriptionClient.this.diagnostic(failure); }
                public void recovered() { Log.i("WafraBilling", "ack:recovered"); }
                public void acknowledge(String token, java.util.function.Consumer<Integer> done) {
                  client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build(),
                      acknowledgement -> done.accept(acknowledgement == null ? null : acknowledgement.getResponseCode()));
                }
              }, callback);
        });
  }

  private void diagnostic(Integer code) {
    // Closed vocabulary only: never log BillingResult.debugMessage or a Purchase.
    int safe = code != null && (code >= -3 && code <= 8 || code == 12) ? code : -2;
    Log.w("WafraBilling", "ack:failed:" + safe);
  }

  public void close() { closed = true; client.endConnection(); }

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
