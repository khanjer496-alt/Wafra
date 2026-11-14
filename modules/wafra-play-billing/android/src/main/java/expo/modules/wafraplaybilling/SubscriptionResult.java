package expo.modules.wafraplaybilling;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Only this projection crosses the Expo bridge. No receipts, tokens or order IDs. */
public final class SubscriptionResult {
  final String status;
  final List<String> activeProductIds;
  final List<String> pendingProductIds;
  final Integer responseCode;
  final boolean needsAcknowledgement;

  private SubscriptionResult(String status, List<String> active, List<String> pending, Integer code, boolean needsAcknowledgement) {
    this.needsAcknowledgement = needsAcknowledgement;
    this.status = status;
    this.activeProductIds = Collections.unmodifiableList(new ArrayList<>(active));
    this.pendingProductIds = Collections.unmodifiableList(new ArrayList<>(pending));
    this.responseCode = code;
  }

  static SubscriptionResult success(List<String> active, List<String> pending) {
    return success(active, pending, false);
  }

  static SubscriptionResult success(List<String> active, List<String> pending, boolean needsAcknowledgement) {
    return new SubscriptionResult(active.isEmpty() ? "inactive" : "active", active, pending, 0, needsAcknowledgement);
  }

  public static SubscriptionResult unknown(Integer code) {
    return new SubscriptionResult("unknown", Collections.emptyList(), Collections.emptyList(), code, false);
  }

  public Map<String, Object> toMap() {
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("status", status);
    result.put("activeProductIds", new ArrayList<>(activeProductIds));
    result.put("pendingProductIds", new ArrayList<>(pendingProductIds));
    result.put("responseCode", responseCode);
    result.put("needsAcknowledgement", needsAcknowledgement);
    return result;
  }
}
