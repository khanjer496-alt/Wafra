package expo.modules.wafraplaybilling;

import java.util.ArrayDeque;
import java.util.ArrayList;

/** Serialized, bounded, one-shot queries. All mutable state belongs to Scheduler. */
public final class SubscriptionQuery {
  public interface Scheduler {
    void execute(Runnable task);
    Runnable after(long delayMillis, Runnable task);
  }
  public interface Factory { Client create(); }
  public interface Client {
    void connect(Connection callback);
    void query(Completion callback);
    void close();
  }
  public interface Connection {
    void setup(Integer responseCode);
    void disconnected();
  }
  public interface Completion { void complete(SubscriptionResult result); }

  public static final long TIMEOUT_MILLIS = 12_000;
  private static final int MAX_QUEUED = 8;
  public static final class Ticket {
    private final Completion completion;
    private Client client;
    private Runnable cancelDeadline;
    private boolean queryStarted;
    private boolean done;
    Ticket(Completion completion) { this.completion = completion; }
  }

  private final Scheduler scheduler;
  private final Factory factory;
  private final ArrayDeque<Ticket> queued = new ArrayDeque<>();
  private Ticket active;
  private boolean destroyed;

  public SubscriptionQuery(Scheduler scheduler, Factory factory) {
    this.scheduler = scheduler;
    this.factory = factory;
  }

  public Ticket query(Completion completion) {
    Ticket ticket = new Ticket(completion);
    scheduler.execute(() -> {
      if (destroyed || queued.size() >= MAX_QUEUED) {
        finish(ticket, SubscriptionResult.unknown(null));
        return;
      }
      // Deadline includes queue time. A later post-purchase call never reuses an
      // earlier pre-purchase result; if it cannot get a fresh answer it is unknown.
      ticket.cancelDeadline = scheduler.after(TIMEOUT_MILLIS,
          () -> finish(ticket, SubscriptionResult.unknown(null)));
      queued.add(ticket);
      startNext();
    });
    return ticket;
  }

  public void cancel(Ticket ticket) {
    scheduler.execute(() -> finish(ticket, SubscriptionResult.unknown(null)));
  }

  public void destroy() {
    scheduler.execute(() -> {
      destroyed = true;
      if (active != null) finish(active, SubscriptionResult.unknown(null));
      for (Ticket ticket : new ArrayList<>(queued)) finish(ticket, SubscriptionResult.unknown(null));
    });
  }

  private void startNext() {
    if (destroyed || active != null || queued.isEmpty()) return;
    Ticket ticket = queued.removeFirst();
    active = ticket;
    try {
      ticket.client = factory.create();
      if (ticket.client == null) throw new IllegalStateException();
      ticket.client.connect(new Connection() {
        public void setup(Integer code) {
          scheduler.execute(() -> {
            if (!isActive(ticket) || ticket.queryStarted) return;
            if (code == null || code != 0) {
              finish(ticket, SubscriptionResult.unknown(code));
              return;
            }
            ticket.queryStarted = true;
            try {
              ticket.client.query(result -> scheduler.execute(() -> {
                if (isActive(ticket)) finish(ticket,
                    result == null ? SubscriptionResult.unknown(null) : result);
              }));
            } catch (Exception ignored) {
              finish(ticket, SubscriptionResult.unknown(null));
            }
          });
        }
        public void disconnected() {
          scheduler.execute(() -> {
            if (isActive(ticket)) finish(ticket, SubscriptionResult.unknown(-1));
          });
        }
      });
    } catch (Exception ignored) {
      finish(ticket, SubscriptionResult.unknown(null));
    }
  }

  private boolean isActive(Ticket ticket) { return active == ticket && !ticket.done; }

  private void finish(Ticket ticket, SubscriptionResult result) {
    if (ticket == null || ticket.done) return;
    ticket.done = true;
    queued.remove(ticket);
    if (ticket.cancelDeadline != null) ticket.cancelDeadline.run();
    // Mark done BEFORE closing: a synchronous disconnect during close is ignored.
    if (ticket.client != null) {
      try { ticket.client.close(); } catch (Exception ignored) { /* no payload logging */ }
      ticket.client = null;
    }
    if (active == ticket) active = null;
    try { ticket.completion.complete(result); }
    catch (Exception ignored) { /* A detached bridge must not strand other requests. */ }
    finally { startNext(); }
  }
}
