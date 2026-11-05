package android.provider

import android.content.ContentResolver

object Settings {
  object Global {
    const val BOOT_COUNT = "boot_count"
    var value = 1
    fun getInt(resolver: ContentResolver, key: String, fallback: Int): Int =
      if (key == BOOT_COUNT) value else fallback
  }
}
