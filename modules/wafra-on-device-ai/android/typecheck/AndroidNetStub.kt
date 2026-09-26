// Compile-only stand-ins; see AndroidContextStub.kt.
package android.net

class Network

class NetworkCapabilities {
  fun hasTransport(transportType: Int): Boolean = false
  fun hasCapability(capability: Int): Boolean = false
  companion object {
    const val TRANSPORT_CELLULAR: Int = 0
    const val TRANSPORT_WIFI: Int = 1
    const val TRANSPORT_ETHERNET: Int = 3
    const val NET_CAPABILITY_NOT_METERED: Int = 11
  }
}

class ConnectivityManager {
  val activeNetwork: Network? = null
  fun getNetworkCapabilities(network: Network?): NetworkCapabilities? = null
}
