package expo.modules.wafraplaybilling;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class SubscriptionQueryTest {
  static SubscriptionResult active() {
    return SubscriptionResult.success(Collections.singletonList("wafra_pro_weekly"), Collections.emptyList());
  }
  static SubscriptionResult inactive() {
    return SubscriptionResult.success(Collections.emptyList(), Collections.emptyList());
  }
  static final class Clock implements SubscriptionQuery.Scheduler {
    long now;
    static final class Task { long at; Runnable run; boolean cancelled; }
    List<Task> tasks = new ArrayList<>();
    public void execute(Runnable r) { r.run(); }
    public Runnable after(long delay, Runnable r) {
      Task t = new Task(); t.at = now + delay; t.run = r; tasks.add(t);
      return () -> t.cancelled = true;
    }
    void advance(long ms) {
      now += ms;
      for (Task t : new ArrayList<>(tasks)) if (!t.cancelled && t.at <= now) {
        t.cancelled = true; t.run.run();
      }
    }
  }
  static final class Client implements SubscriptionQuery.Client {
    SubscriptionQuery.Connection connection;
    SubscriptionQuery.Completion result;
    int queries, closes;
    boolean failConnect, failQuery, disconnectOnClose, throwOnClose;
    public void connect(SubscriptionQuery.Connection c) {
      connection = c;
      if (failConnect) throw new IllegalStateException("synthetic setup failure");
    }
    public void query(SubscriptionQuery.Completion c) {
      queries++; result = c;
      if (failQuery) throw new IllegalStateException("synthetic query failure");
    }
    public void close() {
      closes++;
      if (disconnectOnClose) connection.disconnected();
      if (throwOnClose) throw new IllegalStateException("synthetic close failure");
    }
  }
  static final class Harness {
    Clock clock = new Clock();
    List<Client> clients = new ArrayList<>();
    boolean factoryFails;
    Client next;
    SubscriptionQuery query = new SubscriptionQuery(clock, () -> {
      if (factoryFails) throw new IllegalStateException("synthetic create failure");
      if (!clients.isEmpty()) assertEquals("only one owned client", 1, clients.get(clients.size()-1).closes);
      Client c = next == null ? new Client() : next; next = null; clients.add(c); return c;
    });
    List<SubscriptionResult> results = new ArrayList<>();
    SubscriptionQuery.Ticket request() { return query.query(results::add); }
    Client client() { return clients.get(clients.size()-1); }
    void assertUnknown(Integer code) {
      assertEquals(1,results.size()); assertEquals("unknown",results.get(0).status);
      assertEquals(code,results.get(0).responseCode);
      assertTrue(results.get(0).activeProductIds.isEmpty()); assertTrue(results.get(0).pendingProductIds.isEmpty());
    }
  }

  @Test public void successfulEmptyClosesExactlyOnce() {
    Harness h=new Harness(); h.request(); h.client().connection.setup(0); h.client().result.complete(inactive());
    assertEquals("inactive",h.results.get(0).status); assertEquals(1,h.client().closes);
    h.clock.advance(SubscriptionQuery.TIMEOUT_MILLIS*2); assertEquals(1,h.results.size());
  }
  @Test public void allSetupErrorsAndNullAreUnknown() {
    for (Integer code: Arrays.asList(null,-1,1,2,3,4,5,6,7,8,12)) {
      Harness h=new Harness(); h.request(); h.client().connection.setup(code); h.assertUnknown(code);
      assertEquals(0,h.client().queries); assertEquals(1,h.client().closes);
    }
  }
  @Test public void factoryExceptionIsUnknown() {
    Harness h=new Harness(); h.factoryFails=true; h.request(); h.assertUnknown(null);
  }
  @Test public void setupExceptionClosesClient() {
    Harness h=new Harness(); h.next=new Client(); h.next.failConnect=true; h.request();
    h.assertUnknown(null); assertEquals(1,h.client().closes);
  }
  @Test public void queryExceptionClosesClient() {
    Harness h=new Harness(); h.request(); h.client().failQuery=true; h.client().connection.setup(0);
    h.assertUnknown(null); assertEquals(1,h.client().closes);
  }
  @Test public void setupTimeoutAndLateSetupCannotQuery() {
    Harness h=new Harness(); h.request(); h.clock.advance(SubscriptionQuery.TIMEOUT_MILLIS);
    h.assertUnknown(null); h.client().connection.setup(0);
    assertEquals(0,h.client().queries); assertEquals(1,h.client().closes);
  }
  @Test public void queryTimeoutIgnoresLatePositive() {
    Harness h=new Harness(); h.request(); h.client().connection.setup(0);
    h.clock.advance(SubscriptionQuery.TIMEOUT_MILLIS); h.client().result.complete(active());
    h.assertUnknown(null); assertEquals(1,h.client().closes);
  }
  @Test public void disconnectBeforeSetupIsUnknown() {
    Harness h=new Harness(); h.request(); h.client().connection.disconnected(); h.client().connection.setup(0);
    h.assertUnknown(-1); assertEquals(0,h.client().queries);
  }
  @Test public void disconnectDuringQueryIgnoresLaterSuccess() {
    Harness h=new Harness(); h.request(); h.client().connection.setup(0); h.client().connection.disconnected();
    h.client().result.complete(active()); h.assertUnknown(-1); assertEquals(1,h.client().closes);
  }
  @Test public void duplicateSetupAndResultAreDeliveredOnce() {
    Harness h=new Harness(); h.request(); h.client().connection.setup(0); h.client().connection.setup(0);
    assertEquals(1,h.client().queries); h.client().result.complete(active()); h.client().result.complete(inactive());
    h.client().connection.disconnected(); assertEquals(1,h.results.size()); assertEquals("active",h.results.get(0).status);
  }
  @Test public void postPurchaseRequestDoesNotReuseEarlierQuery() {
    Harness h=new Harness(); h.request(); Client first=h.client(); first.connection.setup(0);
    h.request(); assertEquals(1,h.clients.size()); first.result.complete(inactive());
    assertEquals(2,h.clients.size()); h.client().connection.setup(0); h.client().result.complete(active());
    assertEquals("inactive",h.results.get(0).status); assertEquals("active",h.results.get(1).status);
    first.result.complete(inactive()); assertEquals(2,h.results.size());
  }
  @Test public void cancellingQueuedRequestNeverCreatesItsClient() {
    Harness h=new Harness(); h.request(); SubscriptionQuery.Ticket queued=h.request(); h.query.cancel(queued);
    assertEquals(1,h.clients.size()); h.assertUnknown(null);
    h.client().connection.setup(0); h.client().result.complete(active()); assertEquals(1,h.clients.size());
  }
  @Test public void cancellingActiveClosesBeforeNextAndIgnoresItsLateCallback() {
    Harness h=new Harness(); SubscriptionQuery.Ticket t=h.request(); Client old=h.client(); old.connection.setup(0);
    h.request(); h.query.cancel(t); assertEquals(2,h.clients.size()); assertEquals(1,old.closes);
    old.result.complete(active()); h.assertUnknown(null);
    h.client().connection.setup(0); h.client().result.complete(inactive()); assertEquals(2,h.results.size());
  }
  @Test public void destroyClosesCurrentAndDrainsQueueWithoutNewClients() {
    Harness h=new Harness(); h.request(); Client old=h.client(); old.connection.setup(0); h.request(); h.request();
    h.query.destroy(); h.query.destroy(); h.request(); old.result.complete(active());
    assertEquals(4,h.results.size()); assertTrue(h.results.stream().allMatch(r->r.status.equals("unknown")));
    assertEquals(1,h.clients.size()); assertEquals(1,old.closes);
  }
  @Test public void queuedDeadlineIsNotResetWhenItsTurnBegins() {
    Harness h=new Harness(); h.request(); h.clock.advance(1000); h.request();
    h.clock.advance(11_000); assertEquals(2,h.clients.size());
    h.clock.advance(1000); assertEquals(2,h.results.size()); assertEquals(1,h.client().closes);
  }
  @Test public void queueIsBoundedWithoutSharingResults() {
    Harness h=new Harness(); h.request(); for(int n=0;n<8;n++)h.request(); h.request();
    h.assertUnknown(null); assertEquals(1,h.clients.size()); h.query.destroy(); assertEquals(10,h.results.size());
  }
  @Test public void synchronousDisconnectFromCloseIsIgnored() {
    Harness h=new Harness(); h.request(); h.client().disconnectOnClose=true; h.client().connection.setup(0);
    h.client().result.complete(active()); assertEquals(1,h.results.size()); assertEquals("active",h.results.get(0).status);
  }
  @Test public void closeExceptionDoesNotReplaceSuccessfulQueryOrStrandQueue() {
    Harness h=new Harness(); h.request(); h.request(); Client c=h.client(); c.throwOnClose=true;
    c.connection.setup(0); c.result.complete(active()); assertEquals("active",h.results.get(0).status);
    assertEquals(2,h.clients.size());
  }
  @Test public void detachedCompletionDoesNotStrandQueue() {
    Harness h=new Harness(); h.query.query(result -> { throw new IllegalStateException(); }); h.request();
    h.client().connection.setup(0); h.client().result.complete(inactive()); assertEquals(2,h.clients.size());
  }
  @Test public void nullQueryResultRemainsUnknown() {
    Harness h=new Harness(); h.request(); h.client().connection.setup(0); h.client().result.complete(null); h.assertUnknown(null);
  }
}
