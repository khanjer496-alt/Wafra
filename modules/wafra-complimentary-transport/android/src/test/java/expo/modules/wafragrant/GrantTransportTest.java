package expo.modules.wafragrant;

import static org.junit.Assert.*;

import java.net.CookieHandler;
import java.net.CookieManager;
import okhttp3.*;
import okio.Buffer;
import org.junit.Test;

public final class GrantTransportTest {
  private static final String URL_EXPECTED = "https://wafra-access.khanjer496.workers.dev/v1/access/complimentary";
  private static final String SYNTHETIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq";

  private static void check(int http, String type, String json, String expected) {
    OkHttpClient fixture = GrantTransport.CLIENT.newBuilder().addInterceptor(chain -> {
      Request req = chain.request();
      assertEquals(URL_EXPECTED, req.url().toString());
      assertEquals("POST", req.method());
      assertEquals("Bearer " + SYNTHETIC, req.header("Authorization"));
      assertEquals("application/json", req.header("Accept"));
      assertNull(req.header("Cookie"));
      assertEquals(0, req.body().contentLength());
      Buffer sent = new Buffer();
      req.body().writeTo(sent);
      assertEquals(0, sent.size());
      return new Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(http).message("fixture")
          .body(ResponseBody.create(json, MediaType.get(type))).build();
    }).build();
    assertEquals(expected, GrantTransport.verify(SYNTHETIC, fixture));
  }

  @Test public void dedicatedWireAndFailClosedContract() {
    assertSame(CookieJar.NO_COOKIES, GrantTransport.CLIENT.cookieJar());
    assertSame(Authenticator.NONE, GrantTransport.CLIENT.authenticator());
    assertSame(Authenticator.NONE, GrantTransport.CLIENT.proxyAuthenticator());
    assertFalse(GrantTransport.CLIENT.followRedirects());
    assertFalse(GrantTransport.CLIENT.followSslRedirects());
    assertTrue(GrantTransport.CLIENT.interceptors().isEmpty());
    assertNull(GrantTransport.CLIENT.cache());
    assertEquals("denied", GrantTransport.verify("invalid-short", request -> {throw new AssertionError("Unexpected request");}));
    CookieHandler previous = CookieHandler.getDefault();
    try {
      CookieHandler.setDefault(new CookieManager()); // A global jar must neither leak cookies nor block access.
      String granted = "{\"entitlement\":\"pro\",\"leaseSeconds\":900}";
      check(200, "application/json; charset=utf-8", granted, "granted");
      check(403, "application/json", "{\"error\":\"access_denied\"}", "denied");
      check(403, "text/html", "edge challenge", "unavailable");
      check(200, "application/json", "{\"entitlement\":\"pro\"}", "unavailable");
      check(200, "application/json", "{\"entitlement\":\"pro\",\"leaseSeconds\":901}", "unavailable");
      check(200, "application/json", granted + " trailing", "unavailable");
      check(200, "application/json", String.format("%1100s", granted), "unavailable");
      check(302, "application/json", granted, "unavailable");
      check(404, "application/json", "{\"error\":\"not_found\"}", "unavailable");
    } finally { CookieHandler.setDefault(previous); }
  }
}
