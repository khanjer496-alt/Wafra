package expo.modules.wafragrant;

import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import okhttp3.Authenticator;
import okhttp3.Call;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.BufferedSource;
import org.json.JSONObject;
import org.json.JSONTokener;

/** One fixed publisher endpoint. The JS bridge supplies only a code and receives only a verdict. */
public final class GrantTransport {
  private static final HttpUrl ENDPOINT = HttpUrl.get("https://wafra-access.khanjer496.workers.dev/v1/access/complimentary");
  private static final Pattern CODE = Pattern.compile("[A-Za-z0-9_-]{43}");
  private static final int MAX_RESPONSE_BYTES = 1024;
  private static final RequestBody EMPTY = RequestBody.create(new byte[0], null);
  static final OkHttpClient CLIENT = new OkHttpClient.Builder()
      .cookieJar(CookieJar.NO_COOKIES)
      .authenticator(Authenticator.NONE)
      .proxyAuthenticator(Authenticator.NONE)
      .followRedirects(false)
      .followSslRedirects(false)
      .retryOnConnectionFailure(false)
      .connectTimeout(8, TimeUnit.SECONDS)
      .readTimeout(8, TimeUnit.SECONDS)
      .callTimeout(12, TimeUnit.SECONDS)
      .build();

  private GrantTransport() {}

  public static String verify(String code) {
    return verify(code, CLIENT);
  }

  static String verify(String code, Call.Factory client) {
    if (code == null || !CODE.matcher(code).matches()) return "denied";
    try {
      Request request = new Request.Builder().url(ENDPOINT).post(EMPTY)
          .header("Authorization", "Bearer " + code)
          .header("Accept", "application/json")
          .header("User-Agent", "Wafra-Android")
          .build();
      try (Response response = client.newCall(request).execute()) {
        int status = response.code();
        if (!ENDPOINT.equals(response.request().url()) || (status != 200 && status != 403)) return "unavailable";
        ResponseBody body = response.body();
        MediaType mime = body == null ? null : body.contentType();
        if (mime == null || !"application".equals(mime.type()) || !"json".equals(mime.subtype())) return "unavailable";
        BufferedSource source = body.source();
        if (source.request(MAX_RESPONSE_BYTES + 1L)) return "unavailable";
        JSONTokener json = new JSONTokener(source.readUtf8());
        Object value = json.nextValue();
        if (!(value instanceof JSONObject) || json.nextClean() != 0) return "unavailable";
        JSONObject fields = (JSONObject) value;
        if (status == 403 && "access_denied".equals(fields.opt("error"))) return "denied";
        Object lease = fields.opt("leaseSeconds");
        return status == 200 && "pro".equals(fields.opt("entitlement"))
            && lease instanceof Integer && ((Integer) lease) == 900 ? "granted" : "unavailable";
      }
    } catch (Exception ignored) {
      // Never return networking or parser exceptions that might contain request data.
      return "unavailable";
    }
  }
}
